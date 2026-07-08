const $ = (s) => document.querySelector(s);
const DEMO = {
  home: { name: "Atlético Central", matches: [[2,0,"H"],[1,1,"A"],[3,1,"H"],[0,1,"A"],[2,1,"H"],[2,2,"A"],[1,0,"H"],[1,2,"A"],[3,0,"H"],[1,1,"A"]] },
  away: { name: "Deportivo Norte", matches: [[1,0,"H"],[0,2,"A"],[2,2,"H"],[1,3,"A"],[2,0,"H"],[0,0,"A"],[1,2,"H"],[2,1,"A"],[0,1,"H"],[1,1,"A"]] }
};

let teams = [], manualMode = false, localWorldCupData = null, fbrefProfiles = {}, currentPrediction = null, predictionHistory = [], teamRatings = {}, selectedFixture = null, playerCatalog=[], officialCatalog=[], refereeProfiles=[], matchContexts={}, activeDecisionMarkets=[], historyFilter="all", playableOnlyMode=false;
try{fbrefProfiles=JSON.parse(localStorage.getItem("pg_fbref_profiles")||"{}")}catch(_){localStorage.removeItem("pg_fbref_profiles")}
try{predictionHistory=JSON.parse(localStorage.getItem("pg_prediction_history")||"[]");if(!Array.isArray(predictionHistory))predictionHistory=[]}catch(_){localStorage.removeItem("pg_prediction_history")}
try{matchContexts=JSON.parse(localStorage.getItem("pg_match_contexts")||"{}");if(!matchContexts||typeof matchContexts!=="object")matchContexts={}}catch(_){matchContexts={}}
try{playableOnlyMode=localStorage.getItem("pg_playable_only")==="1"}catch(_){playableOnlyMode=false}

async function saveSharedState(key,value){
  if(location.protocol==="file:")return "local";
  try{const response=await fetch(`/api/state/${encodeURIComponent(key)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}),data=await response.json();return data.storage||"local"}catch(_){return "local"}
}
async function loadSharedState(key){
  if(location.protocol==="file:")return null;
  try{const response=await fetch(`/api/state/${encodeURIComponent(key)}`),data=await response.json();return data.value??null}catch(_){return null}
}
const percent = n => `${Math.round(n * 100)}%`;
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));

function competitionWeight(name=""){
  const value=name.toLowerCase();
  if(value.includes("world cup 2026")||value==="fifa world cup")return 1.22;
  if(value.includes("qualification")||value.includes("eliminatoria"))return 1.12;
  if(value.includes("cup")||value.includes("nations")||value.includes("copa")||value.includes("euro"))return 1.07;
  if(value.includes("friendly")||value.includes("amistoso"))return .78;
  return 1;
}

function weightedStats(matches, targetVenue, details=[],ratingMap=teamRatings) {
  let weight = 0, gf = 0, ga = 0, points = 0, wins = 0, draws = 0;
  matches.slice(0,10).forEach((m,i) => {
    const recency = Math.pow(.9,i);
    const detail=details[i]||{};
    const venueBoost = m[2] === "N" ? 1 : m[2] === targetVenue ? 1.12 : .94;
    const opponentBoost=detail.opponent&&ratingMap[detail.opponent]?clamp(1+(ratingMap[detail.opponent]-1500)/900,.84,1.18):1;
    const w = recency * venueBoost * competitionWeight(detail.tournament||detail.competition) * opponentBoost;
    weight += w; gf += m[0]*w; ga += m[1]*w;
    const p = m[0] > m[1] ? 3 : m[0] === m[1] ? 1 : 0;
    points += p*w; wins += m[0] > m[1]; draws += m[0] === m[1];
  });
  return { gf:gf/weight, ga:ga/weight, ppg:points/weight, wins, draws, losses:matches.length-wins-draws };
}

function poisson(k, lambda){ let f=1; for(let i=2;i<=k;i++) f*=i; return Math.exp(-lambda)*Math.pow(lambda,k)/f; }

function buildEloRatings(history,cutoffDate=null){
  const ratings=Object.fromEntries(Object.keys(history?.teams||{}).map(name=>[name,1500])),seen=new Set(),games=[];
  Object.entries(history?.teams||{}).forEach(([team,data])=>(data.matches||[]).forEach(m=>{
    if(!ratings[m.opponent]||(cutoffDate&&m.date>=cutoffDate))return;
    const pair=[team,m.opponent].sort();const key=`${m.date}|${pair.join("|")}`;
    if(seen.has(key))return;seen.add(key);
    const teamFirst=team===pair[0];games.push({date:m.date,a:pair[0],b:pair[1],ga:teamFirst?m.gf:m.ga,gb:teamFirst?m.ga:m.gf,tournament:m.tournament});
  }));
  games.sort((a,b)=>a.date.localeCompare(b.date)).forEach(g=>{
    const expected=1/(1+Math.pow(10,(ratings[g.b]-ratings[g.a])/400));
    const actual=g.ga>g.gb?1:g.ga===g.gb?.5:0,k=24*competitionWeight(g.tournament);
    const change=k*(actual-expected);ratings[g.a]+=change;ratings[g.b]-=change;
  });
  return ratings;
}

function fixtureContext(match){
  if(!match)return null;const ground=(match.ground||"").toLowerCase();
  const mexico=/mexico city|guadalajara|monterrey/.test(ground),canada=/toronto|vancouver/.test(ground);
  const host=(match.team1==="Mexico"&&mexico)||(match.team1==="Canada"&&canada)||(match.team1==="USA"&&!mexico&&!canada);
  return {...match,neutral:!host};
}

function groupStateBefore(team,fixture){
  const state={played:0,points:0,gf:0,ga:0};if(!fixture?.group||!fixture?.date||!localWorldCupData?.matches)return state;
  localWorldCupData.matches.filter(m=>m.group===fixture.group&&m.date<fixture.date&&Array.isArray(m.score?.ft)&&(m.team1===team||m.team2===team)).forEach(m=>{const home=m.team1===team,gf=home?m.score.ft[0]:m.score.ft[1],ga=home?m.score.ft[1]:m.score.ft[0];state.played++;state.gf+=gf;state.ga+=ga;state.points+=gf>ga?3:gf===ga?1:0});return state;
}
function matchContext(home,away,fixture){
  const rest=(team)=>{const last=team.details?.map(x=>x.date).filter(Boolean).sort().at(-1);return fixture?.date&&last?Math.round((new Date(`${fixture.date}T12:00:00Z`)-new Date(`${last}T12:00:00Z`))/86400000):null},side=(team)=>{const table=groupStateBefore(team.name,fixture),days=rest(team),urgent=table.played>=2&&table.points<=2?"alta":table.played===1&&table.points===0?"media":"normal",urgencyAttack=urgent==="alta"?1.08:urgent==="media"?1.035:1,urgencyExposure=urgent==="alta"?1.06:urgent==="media"?1.025:1,fatigueAttack=days!==null&&days<=3?.94:days===4?.97:1,fatigueExposure=days!==null&&days<=3?1.05:days===4?1.025:1;return{table,restDays:days,urgency:urgent,attack:urgencyAttack*fatigueAttack,exposure:urgencyExposure*fatigueExposure}};
  const h=side(home),a=side(away),notes=[];[[home.name,h],[away.name,a]].forEach(([name,x])=>{if(x.urgency!=="normal")notes.push(`${name} llega con urgencia ${x.urgency} por su situación del grupo (${x.table.points} pts)`);if(x.restDays!==null&&x.restDays<=4)notes.push(`${name} tuvo solo ${x.restDays} días de descanso`)});return{home:h,away:a,notes};
}

function predict(home, away) {
  const ratingMap=home.ratingMap||away.ratingMap||teamRatings;
  const hs=weightedStats(home.matches,"H",home.details,ratingMap), as=weightedStats(away.matches,"A",away.details,ratingMap), base=1.35;
  // Regularizacion a la media reduce el sobreajuste de una muestra de solo 10 juegos.
  const hAttack=.78*hs.gf+.22*base, aDef=.78*as.ga+.22*base;
  const aAttack=.78*as.gf+.22*base, hDef=.78*hs.ga+.22*base;
  const formH=clamp(1+(hs.ppg-as.ppg)*.1,.78,1.22);
  const formA=clamp(1+(as.ppg-hs.ppg)*.1,.78,1.22);
  const ratingDelta=((home.rating||1500)-(away.rating||1500))/400;
  const neutral=selectedFixture?.neutral??false;
  const homeEdge=neutral?1:1.07,awayEdge=neutral?1:.96;
  const context=matchContext(home,away,selectedFixture);
  const personnel=playerCatalog.length?personnelImpact():{home:{attack:1,exposure:1,attackLoss:0,defenseLoss:0,affected:[]},away:{attack:1,exposure:1,attackLoss:0,defenseLoss:0,affected:[]}};
  const xh=clamp(Math.sqrt(hAttack*aDef)*homeEdge*formH*clamp(1+ratingDelta*.22,.82,1.18)*context.home.attack*context.away.exposure*personnel.home.attack*personnel.away.exposure,.25,3.5);
  const xa=clamp(Math.sqrt(aAttack*hDef)*awayEdge*formA*clamp(1-ratingDelta*.22,.82,1.18)*context.away.attack*context.home.exposure*personnel.away.attack*personnel.home.exposure,.2,3.2);
  // Poisson decide el marcador exacto sin inflar artificialmente toda la diagonal.
  const balance=1-Math.abs(xh-xa)/(xh+xa),drawBoost=1+.6*balance;
  let hp=0,dp=0,ap=0,over=0,btts=0,total=0,over15=0,over35=0,homeZero=0,awayZero=0, best={p:0,h:0,a:0},scores=[];
  for(let h=0;h<=7;h++) for(let a=0;a<=7;a++){
    const p=poisson(h,xh)*poisson(a,xa); total+=p;
    if(h>a)hp+=p; else if(h===a)dp+=p; else ap+=p;
    if(h+a>1)over15+=p;if(h+a>2)over+=p;if(h+a>3)over35+=p;if(h>0&&a>0)btts+=p;if(h===0)homeZero+=p;if(a===0)awayZero+=p;
    scores.push({h,a,p});
    if(p>best.p)best={p,h,a};
  }
  hp/=total;dp/=total;ap/=total;over15/=total;over/=total;over35/=total;btts/=total;homeZero/=total;awayZero/=total;
  const outcomeTotal=hp+ap+dp*drawBoost;hp/=outcomeTotal;ap/=outcomeTotal;dp=dp*drawBoost/outcomeTotal;
  const modalScore={...best,p:best.p/total},resultSide=hp>=dp&&hp>=ap?"home":ap>=hp&&ap>=dp?"away":"draw",normalizedScores=scores.map(x=>({...x,p:x.p/total})).sort((a,b)=>b.p-a.p),matchesResult=x=>resultSide==="home"?x.h>x.a:resultSide==="away"?x.a>x.h:x.h===x.a;
  best=normalizedScores.find(matchesResult)||modalScore;scores=normalizedScores.slice(0,3);
  const edge=Math.max(hp,dp,ap)-[hp,dp,ap].sort((a,b)=>b-a)[1];
  const confidenceDetail=modelConfidence(home,away,hs,as,ratingDelta,edge,hp,ap),uncertainty=[...personnel.home.affected,...personnel.away.affected].filter(x=>x.status==="doubt"||x.status==="rotation").length;
  confidenceDetail.score=clamp(confidenceDetail.score-uncertainty*2,20,100);confidenceDetail.label=confidenceDetail.score>=75?"Confianza alta":confidenceDetail.score>=55?"Confianza media":"Confianza baja";
  if(personnel.home.affected.length||personnel.away.affected.length)confidenceDetail.factors.push(`${personnel.home.affected.length+personnel.away.affected.length} ausencia(s) o rotación(es) aplicadas`);
  return {hs,as,xh,xa,hp,dp,ap,over15,over,over35,btts,homeClean:awayZero,awayClean:homeZero,dcHome:hp+dp,dcAway:ap+dp,noDraw:hp+ap,best,modalScore,scores,confidence:confidenceDetail.label,confidenceScore:confidenceDetail.score,confidenceFactors:confidenceDetail.factors,confidenceComponents:confidenceDetail.components,neutral,ratingHome:home.rating||1500,ratingAway:away.rating||1500,drawBoost,matchContext:context,personnel};
}

function calibrateMarketProbability(value,kind){
  if(!Number.isFinite(value))return null;
  if(kind==="cards")return clamp(.7*value+.1,.05,.95);
  if(kind==="corners")return clamp(.8*value+.1,.05,.95);
  return clamp(value,.01,.99);
}

function modelConfidence(home,away,hs,as,ratingDelta,edge,hp,ap){
  const diffs=team=>(team.matches||[]).slice(0,10).map(m=>m[0]-m[1]),std=values=>{if(!values.length)return 3;const mean=values.reduce((s,x)=>s+x,0)/values.length;return Math.sqrt(values.reduce((s,x)=>s+Math.pow(x-mean,2),0)/values.length)};
  const sample=Math.min(1,Math.min(home.matches.length,away.matches.length)/10),separation=clamp(edge/.2,0,1),volatility=(std(diffs(home))+std(diffs(away)))/2,stability=clamp(1-(volatility-.7)/2.6,0,1);
  const data=(home.marketStats&&away.marketStats ? .7 : 0)+(home.fbref&&away.fbref ? .3 : 0),modelDirection=Math.sign(hp-ap),eloDirection=Math.sign(ratingDelta),formDirection=Math.sign(hs.ppg-as.ppg),agreement=(eloDirection===0 ? .65 : modelDirection===eloDirection ? 1 : .25)*.6+(formDirection===0 ? .65 : modelDirection===formDirection ? 1 : .25)*.4;
  const score=Math.round(25*sample+25*separation+20*stability+15*data+15*agreement),label=score>=75?"Confianza alta":score>=55?"Confianza media":"Confianza baja";
  const factors=[`${Math.min(home.matches.length,10)} + ${Math.min(away.matches.length,10)} partidos válidos`,separation>=.65?"ventaja probabilística clara":separation>=.35?"ventaja probabilística moderada":"probabilidades muy cercanas",stability>=.65?"forma relativamente estable":"resultados recientes variables",data>=.7?"perfil estadístico completo":data>0?"datos avanzados parciales":"sin perfil avanzado",agreement>=.75?"Elo, forma y modelo coinciden":"Elo, forma y modelo discrepan"];
  return{score,label,factors,components:{sample,separation,stability,data,agreement}};
}

function normalizeApiTeam(team, payload){
  const source=(payload.matches||[]).slice().sort((a,b)=>new Date(b.utcDate)-new Date(a.utcDate));
  const detailed=source.map(m=>{
    const isHome=m.homeTeam.id===team.id;
    return {values:[isHome?m.score.fullTime.home:m.score.fullTime.away,isHome?m.score.fullTime.away:m.score.fullTime.home,isHome?"H":"A"],competition:m.competition?.name||"Partido internacional"};
  }).filter(m=>Number.isFinite(m.values[0])&&Number.isFinite(m.values[1])).slice(0,10);
  return {name:team.name,matches:detailed.map(m=>m.values),competitions:[...new Set(detailed.map(m=>m.competition))]};
}

function normalizeInternationalTeam(team,payload){
  const source=(payload.response||[]).slice().sort((a,b)=>b.fixture.timestamp-a.fixture.timestamp);
  const detailed=source.map(m=>{
    const isHome=m.teams.home.id===team.id;
    return {values:[isHome?m.goals.home:m.goals.away,isHome?m.goals.away:m.goals.home,isHome?"H":"A"],competition:m.league?.name||"Partido internacional"};
  }).filter(m=>Number.isFinite(m.values[0])&&Number.isFinite(m.values[1])).slice(0,10);
  return {name:team.name,matches:detailed.map(m=>m.values),competitions:[...new Set(detailed.map(m=>m.competition))]};
}

function canonicalSourceTeam(name){
  const aliases={"D.R. Congo":"DR Congo","Congo DR":"DR Congo","RD Congo":"DR Congo","Korea Republic":"South Korea","United States":"USA","Bosnia And Herzegovina":"Bosnia & Herzegovina","Bosnia-Herzegovina":"Bosnia & Herzegovina","Curacao":"Curaçao","Côte d'Ivoire":"Ivory Coast","Jordania":"Jordan","Catar":"Qatar"};
  return aliases[name]||name;
}

function sourceStatsForTeam(record,isHome){
  const side=isHome?"home":"away",other=isHome?"away":"home",value=(key,target=side)=>record.stats?.[key]?.[target]??null;
  return{shots:value("shots"),opponent_shots:value("shots",other),shots_on_target:value("shotsOnTarget"),opponent_shots_on_target:value("shotsOnTarget",other),fouls:value("fouls"),opponent_fouls:value("fouls",other),corners:value("corners"),opponent_corners:value("corners",other),cards_yellow:value("yellowCards"),opponent_cards_yellow:value("yellowCards",other),cards_red:value("redCards"),xg:value("xg"),opponent_xg:value("xg",other),source:record.source};
}

function applyEnrichedWorldCupData(matchData,enriched,oddsSnapshot){
  const findFixture=(home,away)=>matchData.matches.find(m=>m.team1===home&&m.team2===away);
  (enriched?.current||[]).forEach(record=>{const home=canonicalSourceTeam(record.home),away=canonicalSourceTeam(record.away),fixture=findFixture(home,away);if(!fixture)return;fixture.stats={home:sourceStatsForTeam(record,true),away:sourceStatsForTeam(record,false)};fixture.sourceOdds=record.odds;if(!Array.isArray(fixture.score?.ft)&&Number.isFinite(record.homeGoals)&&Number.isFinite(record.awayGoals))fixture.score={ft:[record.homeGoals,record.awayGoals],ht:[record.halfTime?.home,record.halfTime?.away],source:record.source}});
  (oddsSnapshot?.matches||[]).forEach(record=>{const home=canonicalSourceTeam(record.home),away=canonicalSourceTeam(record.away),fixture=findFixture(home,away);if(!fixture)return;fixture.marketOdds={home:record.homeOdds,draw:record.drawOdds,away:record.awayOdds,capturedAt:record.capturedAt,source:record.source};if(!Array.isArray(fixture.score?.ft)&&record.status==="Finished"&&Number.isFinite(record.score?.home)&&Number.isFinite(record.score?.away))fixture.score={ft:[record.score.home,record.score.away],source:record.source}});
}

const PERSONNEL_STATUS={probable:"Titular probable",confirmed:"Titular confirmado",doubt:"Duda",out:"Baja",suspended:"Suspendido",rotation:"Posible rotación"};
function catalogTeamName(name){return({"South Korea":"Korea Republic","Cape Verde":"Cabo Verde","DR Congo":"Congo DR","Ivory Coast":"Côte D'Ivoire","Curaçao":"Curacao","Czech Republic":"Czechia","Bosnia & Herzegovina":"Bosnia And Herzegovina","Turkey":"Türkiye","Iran":"IR Iran"})[name]||name}
function activeMatchKey(){const home=$("#homeTeam")?.value||"",away=$("#awayTeam")?.value||"",fixture=localWorldCupData?.matches?.find(m=>m.team1===home&&m.team2===away);return `${fixture?.date||selectedFixture?.date||"sin-fecha"}|${home}|${away}`}
function activeMatchContext(){const key=activeMatchKey();return matchContexts[key]||(matchContexts[key]={playerStatuses:{},lineups:{home:[],away:[]},refereeId:null,refereeName:null,refereeCards:null,refereeFouls:null,updatedAt:new Date().toISOString()})}
function saveMatchContexts(){const context=activeMatchContext();context.personnelImpact=playerCatalog.length?personnelImpact():null;context.updatedAt=new Date().toISOString();localStorage.setItem("pg_match_contexts",JSON.stringify(matchContexts));saveSharedState("match-contexts",matchContexts)}
function num(value){const result=Number(value);return Number.isFinite(result)?result:0}
function playerScore(player){const s=player.tournamentStats||{},starts=num(s.games_starts),minutes=num(s.minutes),games=num(s.games),caps=num(player.caps);return starts*18+minutes/90*7+games*3+Math.min(caps,100)*.08+num(s.goals)*4+num(s.assists)*3}
function playersForTeam(name){return playerCatalog.filter(p=>p.team===catalogTeamName(name)).sort((a,b)=>playerScore(b)-playerScore(a))}
function probableLineup(name){
  const roster=playersForTeam(name),requirements={PO:1,DF:4,MC:3,DC:3},picked=[];
  Object.entries(requirements).forEach(([position,count])=>picked.push(...roster.filter(p=>p.position===position).slice(0,count)));
  roster.forEach(player=>{if(picked.length<11&&!picked.some(x=>x.id===player.id))picked.push(player)});return picked.slice(0,11);
}
function lineupConfidence(lineup){if(!lineup.length)return 0;const covered=lineup.filter(p=>p.tournamentStats).length/lineup.length,starters=lineup.filter(p=>num(p.tournamentStats?.games_starts)>0).length/lineup.length;return Math.round(45+covered*30+starters*20)}
function playerImpact(player){const s=player.tournamentStats||{},minutes=Math.min(1,num(s.minutes)/450),attacking=/MC|DC/.test(player.position),defending=/PO|DF|MC/.test(player.position),attack=clamp(minutes*.025+num(s.goals)*.012+num(s.assists)*.01+num(s.shots)*.0015+(attacking?.012:0),.005,.12),defense=clamp(minutes*.025+num(s.interceptions)*.002+num(s.tackles_won)*.002+(defending?.015:0),.005,.11);return{attack,defense}}
function personnelImpact(){
  const context=activeMatchContext(),factor={out:1,suspended:1,doubt:.5,rotation:.35},side=name=>{let attackLoss=0,defenseLoss=0,affected=[];playersForTeam(name).forEach(player=>{const status=context.playerStatuses[player.id];if(!factor[status])return;const impact=playerImpact(player),weight=factor[status];attackLoss+=impact.attack*weight;defenseLoss+=impact.defense*weight;affected.push({playerId:player.id,name:player.name,status,attackImpact:impact.attack*weight,defenseImpact:impact.defense*weight})});return{attack:clamp(1-attackLoss,.72,1),exposure:clamp(1+defenseLoss,1,1.3),attackLoss,defenseLoss,affected}};
  return{home:side($("#homeTeam").value),away:side($("#awayTeam").value)};
}
function normalizedName(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z ]/g," ").toLowerCase().trim().replace(/\s+/g," ")}
function refereeProfileFor(official){if(!official)return null;const parts=normalizedName(official.name).split(" "),surname=parts[0],initial=parts.at(-1)?.[0];return refereeProfiles.find(profile=>{const p=normalizedName(profile.referee).split(" ");return p.at(-1)===surname&&(!initial||p[0]?.[0]===initial)})||null}
function safeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function renderLineup(side,name){
  const lineup=probableLineup(name),context=activeMatchContext();context.teams={home:$("#homeTeam").value,away:$("#awayTeam").value};context.lineups[side]=lineup.map(p=>p.id);context.lineupDetails=context.lineupDetails||{};context.lineupDetails[side]=lineup.map(p=>({id:p.id,name:p.name,position:p.position,shirtNumber:p.shirtNumber}));$(`#${side}LineupName`).textContent=name;$(`#${side}LineupConfidence`).textContent=`Confianza ${lineupConfidence(lineup)}%`;
  $(`#${side}Lineup`).innerHTML=lineup.length?lineup.map(player=>{const status=context.playerStatuses[player.id]||"probable",impact=playerImpact(player);return`<div class="lineup-player ${status==="out"||status==="suspended"?"out":""}"><i>${safeHtml(player.position)} · ${player.shirtNumber}</i><div><strong>${safeHtml(player.name)}</strong><small>${safeHtml(player.club)} · impacto ${(impact.attack+impact.defense).toFixed(2)}</small></div><select data-player-id="${player.id}" data-team="${safeHtml(name)}">${Object.entries(PERSONNEL_STATUS).map(([value,label])=>`<option value="${value}" ${status===value?"selected":""}>${label}</option>`).join("")}</select></div>`}).join(""):'<div class="prematch-note">Sin plantel disponible.</div>';
}
function updateRefereePanel(){
  const context=activeMatchContext(),official=officialCatalog.find(x=>x.id===context.refereeId),profile=refereeProfileFor(official);$("#matchReferee").value=context.refereeId||"";
  const hasValue=value=>value!==null&&value!==""&&Number.isFinite(Number(value));
  if(profile){if(!hasValue(context.refereeCards))context.refereeCards=profile.cardsPerMatch;if(!hasValue(context.refereeFouls))context.refereeFouls=profile.foulsPerMatch;$("#refereeSource").textContent=`Perfil europeo coincidente · ${profile.matches} partidos · ${profile.source}`}else $("#refereeSource").textContent=official?"Árbitro FIFA seleccionado · sin historial estadístico coincidente":"Lista FIFA cargada · sin designación confirmada";
  $("#refereeCards").value=hasValue(context.refereeCards)?Number(context.refereeCards).toFixed(1):"";$("#refereeFouls").value=hasValue(context.refereeFouls)?Number(context.refereeFouls).toFixed(1):"";
  const parts=[];if(hasValue(context.refereeCards)&&Number(context.refereeCards)>0)parts.push(`${Number(context.refereeCards).toFixed(1)} tarjetas`);if(hasValue(context.refereeFouls)&&Number(context.refereeFouls)>0)parts.push(`${Number(context.refereeFouls).toFixed(1)} faltas`);$("#refereeImpact").textContent=parts.length?`Ajuste activo: ${parts.join(" · ")}`:"Sin ajuste arbitral";$("#refereeImpact").classList.toggle("active",Boolean(parts.length));
}
function renderPrematchPanel(){
  if(!localWorldCupData||!playerCatalog.length)return;$("#prematchPanel").classList.remove("hidden");const home=$("#homeTeam").value,away=$("#awayTeam").value;renderLineup("home",home);renderLineup("away",away);const context=activeMatchContext();
  $("#matchReferee").innerHTML='<option value="">Sin confirmar</option>'+officialCatalog.filter(x=>x.role==="Referee").map(x=>`<option value="${x.id}">${safeHtml(x.name)} · ${safeHtml(x.association)}</option>`).join("");$("#prematchCoverage").textContent=`${probableLineup(home).length}+${probableLineup(away).length} jugadores · ${context.refereeId?"árbitro seleccionado":"árbitro pendiente"}`;updateRefereePanel();saveMatchContexts();
}

function observedStat(team,key,mode="own"){
  const opponentKey=`opponent_${key}`;return(team.details||[]).map(detail=>{const own=Number(detail.stats?.[key]),opponent=Number(detail.stats?.[opponentKey]);if(mode==="own")return own;if(mode==="opponent")return opponent;return Number.isFinite(own)&&Number.isFinite(opponent)?own+opponent:null}).filter(Number.isFinite);
}
function mean(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null}
function normalCdf(z){const sign=z<0?-1:1,x=Math.abs(z)/Math.sqrt(2),t=1/(1+.3275911*x),erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return .5*(1+sign*erf)}
function buildLineSet(values,expected,label,stat,scope,teamName=null){
  if(!Number.isFinite(expected)||values.length<2)return[];const variance=values.reduce((sum,value)=>sum+Math.pow(value-mean(values),2),0)/Math.max(1,values.length-1),sd=Math.max(1.4,Math.sqrt(variance)),center=Math.floor(expected)+.5,lines=[center-1,center,center+1].filter(x=>x>.5);return lines.flatMap(threshold=>{const raw=1-normalCdf((threshold-expected)/sd),weight=Math.min(1,values.length/10),over=clamp(.5+(raw-.5)*weight,.08,.92),prefix=teamName?`${teamName} `:"";return[{id:`${stat}_${scope}_over_${threshold}`,label:`${prefix}más de ${threshold} ${label}`,probability:over,kind:"total",stat,scope,side:"over",threshold,sample:values.length,team:teamName},{id:`${stat}_${scope}_under_${threshold}`,label:`${prefix}menos de ${threshold} ${label}`,probability:1-over,kind:"total",stat,scope,side:"under",threshold,sample:values.length,team:teamName}]})
}
function buildStatMarket(home,away,key,label,stat){
  const homeOwn=observedStat(home,key,"own"),awayOwn=observedStat(away,key,"own"),homeAllowed=observedStat(home,key,"opponent"),awayAllowed=observedStat(away,key,"opponent"),totals=[...observedStat(home,key,"total"),...observedStat(away,key,"total")],homeExpected=mean([mean(homeOwn),mean(awayAllowed)].filter(Number.isFinite)),awayExpected=mean([mean(awayOwn),mean(homeAllowed)].filter(Number.isFinite));let totalExpected=homeExpected+awayExpected;
  const context=activeMatchContext();if(stat==="fouls"&&Number(context.refereeFouls)>0)totalExpected=Number.isFinite(totalExpected)?totalExpected*.7+Number(context.refereeFouls)*.3:Number(context.refereeFouls);
  const lines=[...buildLineSet(totals,totalExpected,label,stat,"total"),...buildLineSet([...homeOwn,...awayAllowed],homeExpected,label,stat,"home",home.name),...buildLineSet([...awayOwn,...homeAllowed],awayExpected,label,stat,"away",away.name)],recommended=[...lines].filter(x=>x.probability>=.5).sort((a,b)=>Math.abs(a.probability-.68)-Math.abs(b.probability-.68)||b.probability-a.probability)[0]||null;return{expectedTotal:totalExpected,homeExpected,awayExpected,sample:totals.length,lines,recommended};
}
function buildStatMarkets(home,away){return{shots:buildStatMarket(home,away,"shots","tiros","shots"),shotsOnTarget:buildStatMarket(home,away,"shots_on_target","tiros al arco","shots_on_target"),fouls:buildStatMarket(home,away,"fouls","faltas","fouls")}}

function normalizeLocalWorldCupTeam(name,cutoffDate=null,ratingMap=teamRatings){
  const current=localWorldCupData.matches.filter(m=>m.team1===name||m.team2===name)
    .filter(m=>Array.isArray(m.score?.ft)&&(!cutoffDate||m.date<cutoffDate)).map(m=>{
      const isHome=m.team1===name;
      return {date:m.date,opponent:isHome?m.team2:m.team1,gf:isHome?m.score.ft[0]:m.score.ft[1],ga:isHome?m.score.ft[1]:m.score.ft[0],venue:isHome?"H":"A",tournament:"World Cup 2026",stats:isHome?m.stats?.home:m.stats?.away};
    });
  const previous=(localWorldCupData.history?.teams?.[name]?.matches||[]).filter(m=>!cutoffDate||m.date<cutoffDate),qualifiers=(localWorldCupData.enriched?.qualifiers||[]).filter(m=>(m.home===name||m.away===name)&&(!cutoffDate||m.date<cutoffDate)).map(m=>{const isHome=m.home===name;return{date:m.date,opponent:isHome?m.away:m.home,gf:isHome?m.homeGoals:m.awayGoals,ga:isHome?m.awayGoals:m.homeGoals,venue:isHome?"H":"A",tournament:m.competition,stats:sourceStatsForTeam(m,isHome)}});
  const unique=new Map(previous.map(m=>[`${m.date}|${m.opponent}`,m]));
  qualifiers.forEach(m=>unique.set(`${m.date}|${m.opponent}`,{...(unique.get(`${m.date}|${m.opponent}`)||{}),...m}));
  current.forEach(m=>unique.set(`${m.date}|${m.opponent}`,{...(unique.get(`${m.date}|${m.opponent}`)||{}),...m}));
  const detailed=[...unique.values()].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
  return {name,matches:detailed.map(m=>[m.gf,m.ga,m.venue]),details:detailed,competitions:[...new Set(detailed.map(m=>m.tournament))],advancedMatches:detailed.filter(m=>m.stats).length,marketStats:localWorldCupData.footy?.teams?.[name]||null,fbref:fbrefProfiles[name]||null,rating:ratingMap[name]||1500,ratingMap,cutoffDate};
}

function numberFromCell(cell){
  if(!cell)return null;const raw=(cell.getAttribute("csk")||cell.textContent||"").replace(/[^0-9.,-]/g,"").replace(/\.(?=\d{3}(?:\D|$))/g,"").replace(",",".");
  const value=Number(raw);return Number.isFinite(value)?value:null;
}

function totalStats(doc,tableId,stats){
  const table=doc.querySelector(`#${tableId}`);if(!table)return {};
  const rows=[...table.querySelectorAll("tfoot tr,tbody tr")];
  const row=rows.find(r=>/squad total|total del equipo|total de la plantilla/i.test(r.textContent))||table.querySelector("tfoot tr:last-child");
  if(!row)return {};
  return Object.fromEntries(stats.map(stat=>[stat,numberFromCell(row.querySelector(`[data-stat="${stat}"]`))]));
}

function parseFbrefHtml(text,filename){
  const doc=new DOMParser().parseFromString(text,"text/html");
  const match=filename.match(/^(.*?)_FBref_(\d{4})/i);
  let team=match?match[1].replace(/[_-]+/g," "):"";let season=match?match[2]:"";
  const caption=doc.querySelector("#matchlogs_for caption")?.textContent||"";
  if(!team){const found=caption.match(/(\d{4})\s+(.+?):/);if(found){season=found[1];team=found[2].trim()}}
  const teamAliases={"Korea Republic":"South Korea","United States":"USA","Czechia":"Czech Republic","Bosnia and Herzegovina":"Bosnia & Herzegovina","Cape Verde Islands":"Cape Verde","Congo DR":"DR Congo"};
  team=teamAliases[team]||team;
  if(!team||!season)throw new Error(`No pude identificar selección y año en ${filename}. Usa un nombre como Mexico_FBref_2026.html.`);
  const rows=[...doc.querySelectorAll("#matchlogs_for tbody tr")];
  const matches=rows.map(row=>{
    const dateCell=row.querySelector('[data-stat="date"]'),gf=numberFromCell(row.querySelector('[data-stat="goals_for"]')),ga=numberFromCell(row.querySelector('[data-stat="goals_against"]'));
    if(!dateCell||gf===null||ga===null)return null;
    const csk=dateCell.getAttribute("csk")||"";const date=/^\d{8}$/.test(csk)?`${csk.slice(0,4)}-${csk.slice(4,6)}-${csk.slice(6,8)}`:dateCell.textContent.trim();
    const opponentCell=row.querySelector('[data-stat="opponent"]');const opponent=opponentCell?.querySelector('a[href*="/squads/"]')?.textContent.trim()||opponentCell?.textContent.trim()||"";
    const venueText=row.querySelector('[data-stat="venue"]')?.textContent.trim().toLowerCase()||"";
    const venue=/neutral/.test(venueText)?"N":/home|hogar|casa/.test(venueText)?"H":"A";
    return {date,opponent,gf,ga,venue,competition:row.querySelector('[data-stat="comp"]')?.textContent.trim()||"",possession:numberFromCell(row.querySelector('[data-stat="possession"]')),formation:row.querySelector('[data-stat="formation"]')?.textContent.trim()||null,opponent_formation:row.querySelector('[data-stat="opp_formation"]')?.textContent.trim()||null};
  }).filter(Boolean);
  const totals={
    ...totalStats(doc,"stats_shooting_combined",["shots","shots_on_target","goals","average_shot_distance"]),
    ...totalStats(doc,"stats_misc_combined",["cards_yellow","cards_red","fouls","fouled","offsides","crosses","interceptions","tackles_won","pens_won","pens_conceded"]),
    ...totalStats(doc,"stats_keeper_combined",["gk_saves","gk_save_pct","gk_clean_sheets","gk_goals_against"])
  };
  return {team,season,matches,totals};
}

function fbrefRate(profile,stat){
  let total=0,games=0;Object.values(profile?.seasons||{}).forEach(s=>{if(Number.isFinite(s.totals?.[stat])){total+=s.totals[stat];games+=s.matches.length}});
  return games?total/games:null;
}

function updateFbrefStatus(){
  const names=Object.keys(fbrefProfiles);const el=$("#fbrefStatus");if(!el)return;
  el.textContent=names.length?`${names.length} perfil(es) guardado(s): ${names.join(", ")}.`:"Todavía no hay perfiles FBref importados.";
}

function fillTeamSelectors(list){
  const opts=list.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
  $("#homeTeam").innerHTML=opts;$("#awayTeam").innerHTML=opts;
  if(list[1])$("#awayTeam").value=String(list[1].id);
}

function parseManual(text,name){
  const rows=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const matches=[], competitions=[];
  for(const row of rows){
    const cols=row.split(/[,;]/).map(x=>x.trim());
    if(/goles|resultado|fecha/i.test(row)&&!/^\d+\s*[-:]/.test(row))continue;
    let gf,ga,venue,tournament;
    const score=cols[0]?.match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if(score){gf=+score[1];ga=+score[2];venue=cols[1];tournament=cols.slice(2).join(" ")}
    else if(/^\d+$/.test(cols[0])&&/^\d+$/.test(cols[1])){gf=+cols[0];ga=+cols[1];venue=cols[2];tournament=cols.slice(3).join(" ")}
    else if(cols.length>=5&&/^\d+$/.test(cols[1])&&/^\d+$/.test(cols[2])){gf=+cols[1];ga=+cols[2];venue=cols[3];tournament=cols.slice(4).join(" ")}
    else throw new Error(`${name}: no entiendo la línea “${row}”. Usa 2-0, L, Amistoso.`);
    const v=(venue||"").toUpperCase();
    const normalized=["L","H","LOCAL","CASA"].includes(v)?"H":["V","A","VISITANTE","FUERA"].includes(v)?"A":null;
    if(!normalized)throw new Error(`${name}: indica L (local) o V (visitante) en “${row}”.`);
    matches.push([gf,ga,normalized]); competitions.push(tournament||"Partido internacional");
  }
  if(matches.length!==10)throw new Error(`${name}: hay ${matches.length} partidos; deben ser exactamente 10.`);
  return {name,matches,competitions:[...new Set(competitions)]};
}

function updateManualCount(textarea,count){
  const n=textarea.value.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/goles|resultado|fecha/i.test(x)).length;
  count.textContent=`${n} de 10 partidos`;count.classList.toggle("ready",n===10);
}

function setManualMode(active){
  manualMode=active;
  if(active){
    localWorldCupData=null;teams=[];
    $("#homeTeam").innerHTML='<option value="demo-home">Atlético Central</option>';
    $("#awayTeam").innerHTML='<option value="demo-away">Deportivo Norte</option>';
  }
  $("#manualPanel").classList.toggle("hidden",!active);
  $("#apiPanel").classList.add("hidden");
  $(".teams").classList.toggle("hidden",active);
  $("#sourceStatus").textContent=active?"Carga manual gratuita":"Modo demostración";
  $("#toggleManual").textContent=active?"← Volver a equipos":"✎ Carga manual / CSV";
}

function initials(name){ return name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase(); }
function formHtml(team, stats){
  const dots=team.matches.map(m=>m[0]>m[1]?["G","win"]:m[0]===m[1]?["E","draw-dot"]:["P","loss"]);
  const sources=team.competitions?.length?`<div class="sources">Incluye: ${team.competitions.join(" · ")}</div>`:"";
  return `<div class="form-head"><h3>${team.name}</h3><span class="record">${stats.wins}G · ${stats.draws}E · ${stats.losses}P</span></div><div class="form-dots">${dots.map(d=>`<i class="${d[1]}">${d[0]}</i>`).join("")}</div>${sources}<div class="stats"><div class="stat"><b>${stats.ppg.toFixed(2)}</b><span>PUNTOS/PARTIDO</span></div><div class="stat"><b>${stats.gf.toFixed(2)}</b><span>GOLES A FAVOR</span></div><div class="stat"><b>${stats.ga.toFixed(2)}</b><span>GOLES EN CONTRA</span></div></div>`;
}

function chooseOfficialLine(candidates,target=.68){
  const valid=candidates.filter(x=>Number.isFinite(x.probability)&&x.probability>=.5&&x.probability<1);
  if(!valid.length)return null;
  return valid.sort((a,b)=>Math.abs(a.probability-target)-Math.abs(b.probability-target)||b.probability-a.probability)[0];
}
function totalLineCandidates(lines,stat,experimental=false){
  return Object.entries(lines||{}).flatMap(([key,value])=>{const threshold=Number(key.replace("_",".")),over=stat==="cards"?.5+(value-.5)*.55:value;if(!Number.isFinite(threshold)||!Number.isFinite(over))return[];return[
    {market:stat,stat,side:"over",threshold,probability:over,label:`Más de ${threshold} ${stat==="goals"?"goles":stat==="corners"?"córners":"tarjetas"}`,experimental},
    {market:stat,stat,side:"under",threshold,probability:1-over,label:`Menos de ${threshold} ${stat==="goals"?"goles":stat==="corners"?"córners":"tarjetas"}`,experimental}
  ]});
}
function buildOfficialPicks(prediction){
  const p=prediction.probabilities,resultSide=["home","draw","away"].sort((a,b)=>p[b]-p[a])[0],resultLabels={home:`${prediction.home} gana`,draw:"Empate",away:`${prediction.away} gana`},bttsPick=p.btts>=.55?{market:"btts",side:"yes",probability:p.btts,label:"Ambos marcan: sí"}:p.btts<=.45?{market:"btts",side:"no",probability:1-p.btts,label:"Ambos marcan: no"}:{market:"btts",side:"abstain",probability:Math.max(p.btts,1-p.btts),yesProbability:p.btts,noProbability:1-p.btts,label:"Ambos marcan: sin ventaja clara",abstain:true};
  const goalLines={"1_5":p.over15,"2_5":p.over25,"3_5":p.over35},cards=chooseOfficialLine(totalLineCandidates(prediction.footy?.cardsLines,"cards",true));
  return{
    winner:{market:"result",side:resultSide,probability:p[resultSide],label:resultLabels[resultSide]},
    exact:{market:"exact",homeGoals:prediction.score.home,awayGoals:prediction.score.away,probability:prediction.score.probability,label:`Marcador ${prediction.score.home}–${prediction.score.away}`},
    goals:chooseOfficialLine(totalLineCandidates(goalLines,"goals")),
    btts:bttsPick,
    corners:chooseOfficialLine(totalLineCandidates(prediction.footy?.cornersLines,"corners")),
    cards,
    shots:prediction.statMarkets?.shots?.recommended?{...prediction.statMarkets.shots.recommended,market:"total"}:null,
    shotsOnTarget:prediction.statMarkets?.shotsOnTarget?.recommended?{...prediction.statMarkets.shotsOnTarget.recommended,market:"total"}:null,
    fouls:prediction.statMarkets?.fouls?.recommended?{...prediction.statMarkets.fouls.recommended,market:"total"}:null
  };
}

function setAppTab(tab,scroll=false){
  document.querySelectorAll(".app-tab").forEach(button=>button.classList.toggle("active",button.dataset.tab===tab));
  document.querySelectorAll("[data-app-view]").forEach(section=>section.classList.toggle("app-view-hidden",section.dataset.appView!==tab));
  if(scroll){const target=document.querySelector(`[data-app-view="${tab}"]:not(.hidden)`);(target||document.querySelector("main"))?.scrollIntoView({behavior:"smooth",block:"start"})}
}
function decisionMarketFromPick(key,pick){
  if(!pick||pick.abstain)return null;
  const kind=pick.market==="result"?"result":pick.market==="btts"?"btts":pick.market==="exact"?"exact":"total";
  return{id:`official_${key}`,label:pick.label,probability:pick.probability,kind,stat:pick.stat,scope:pick.scope,side:pick.side,threshold:pick.threshold,homeGoals:pick.homeGoals,awayGoals:pick.awayGoals,official:true,experimental:pick.experimental,estimated:pick.estimated,sample:pick.sample};
}
function decisionMarketsFromPrediction(prediction){
  if(!prediction)return[];
  if(typeof labMarketsFromPrediction==="function")return labMarketsFromPrediction(prediction);
  return Object.entries(prediction.officialPicks||{}).map(([key,pick])=>decisionMarketFromPick(key,pick)).filter(Boolean).sort((a,b)=>Number(b.official)-Number(a.official)||b.probability-a.probability);
}
function selectedDecisionMarket(){return activeDecisionMarkets.find(m=>m.id===$("#decisionMarket")?.value)||null}
function renderDecisionCalculator(){
  const market=selectedDecisionMarket(),odds=Number($("#decisionOdds")?.value),lineMatches=Boolean($("#decisionLineMatch")?.checked),output=$("#decisionOutput");
  if(!output)return;
  if(!currentPrediction||!market){output.innerHTML='<div class="decision-state read"><b>SOLO LECTURA</b><span>Genera un pronóstico y elige un mercado para comparar contra la cuota real.</span></div>';return}
  const fair=1/market.probability,validOdds=Number.isFinite(odds)&&odds>1,edge=validOdds?market.probability*odds-1:null,implied=validOdds?1/odds:null;
  if(!lineMatches){
    output.innerHTML=`<div class="decision-state block"><b>NO COMPARABLE</b><span>${safeHtml(repairLegacyText(market.label))}. Marca la casilla solo si la casa ofrece exactamente esta misma línea. Si cambia de -3.5 a -2.5, +1.5, 0.5 tarjetas a 1.5, etc., no es la misma apuesta.</span>${validOdds?decisionMetrics(market,fair,odds,implied,edge):""}<small>Decisión: pasar hasta encontrar la misma línea o recalcular otro mercado.</small></div>`;return;
  }
  if(!validOdds){
    output.innerHTML=`<div class="decision-state read"><b>SOLO LECTURA</b><span>${safeHtml(repairLegacyText(market.label))}. Probabilidad del modelo ${percent(market.probability)}; cuota justa ${fair.toFixed(2)}. Escribe la cuota de Bettsson/casa para decidir.</span></div>`;return;
  }
  const restricted=market.experimental||market.estimated||["shots_on_target","fouls"].includes(market.stat),enter=edge>=.05&&!restricted,state=enter?"enter":restricted?"pass":"pass",title=enter?"ENTRAR":"PASAR";
  const reason=restricted?"Mercado en prueba o estimado: úsalo solo en simulación hasta tener más muestra.":edge>=.05?"La cuota supera la cuota justa con margen suficiente.":"La cuota no compensa el riesgo aunque el pick pueda salir.";
  output.innerHTML=`<div class="decision-state ${state}"><b>${title}</b><span>${safeHtml(repairLegacyText(market.label))}. ${reason}</span>${decisionMetrics(market,fair,odds,implied,edge)}<small>${restricted?"Recomendación: no dinero real por ahora.":"Regla activa: entrar solo desde +5% de edge y línea exacta."}</small></div>`;
}
function decisionMetrics(market,fair,odds,implied,edge){
  const tone=edge>.05?"good":edge>=0?"watch":"bad";
  return `<div class="decision-metrics"><div><span>Modelo</span><b>${percent(market.probability)}</b></div><div><span>Justa</span><b>${fair.toFixed(2)}</b></div><div><span>Casa</span><b>${odds.toFixed(2)}</b></div><div><span>Edge</span><b class="${tone}">${edge>=0?"+":""}${Math.round(edge*100)}%</b></div></div><small>Probabilidad implícita de la casa: ${percent(implied)}.</small>`;
}
function updateDecisionPanel(){
  const select=$("#decisionMarket"),label=$("#decisionMatchLabel");if(!select)return;
  activeDecisionMarkets=decisionMarketsFromPrediction(currentPrediction);
  if(label)label.textContent=currentPrediction?`${currentPrediction.home} vs ${currentPrediction.away}`:"Genera un pronóstico";
  select.innerHTML=activeDecisionMarkets.length?activeDecisionMarkets.map(m=>`<option value="${m.id}">${m.official?"★ Oficial · ":""}${m.experimental?"⚠ Experimental · ":""}${m.estimated?"Estimado · ":""}${safeHtml(repairLegacyText(m.label))} · ${percent(m.probability)}</option>`).join(""):'<option value="">Genera primero un pronóstico</option>';
  $("#decisionOdds").value="";$("#decisionLineMatch").checked=false;renderDecisionCalculator();
}

function normalizeThreeWay(probabilities){
  const total=Math.max(.0001,probabilities.home+probabilities.draw+probabilities.away);
  return{home:probabilities.home/total,draw:probabilities.draw/total,away:probabilities.away/total};
}

function eloShadowProbabilities(home,away,r){
  const homeAdvantage=r.neutral?0:55,difference=(r.ratingHome-r.ratingAway)+homeAdvantage;
  const decisive=1/(1+Math.pow(10,-difference/400)),draw=clamp(.29-Math.abs(difference)/1800,.17,.29),remaining=1-draw;
  return normalizeThreeWay({home:decisive*remaining,draw,away:(1-decisive)*remaining});
}

function formShadowProbabilities(r){
  const goalEdge=(r.hs.gf-r.hs.ga)-(r.as.gf-r.as.ga),pointsEdge=r.hs.ppg-r.as.ppg;
  const signal=clamp(pointsEdge*.72+goalEdge*.34,-2.2,2.2),draw=clamp(.3-Math.abs(signal)*.055,.18,.3),homeShare=1/(1+Math.exp(-signal)),remaining=1-draw;
  return normalizeThreeWay({home:homeShare*remaining,draw,away:(1-homeShare)*remaining});
}

function buildShadowEnsemble(home,away,r){
  const poisson={home:r.hp,draw:r.dp,away:r.ap},elo=eloShadowProbabilities(home,away,r),form=formShadowProbabilities(r);
  // Pesos provisionales y congelados: el ensemble no participa en apuestas hasta ser validado.
  const weights={poisson:.55,elo:.27,form:.18},blend=normalizeThreeWay({
    home:poisson.home*weights.poisson+elo.home*weights.elo+form.home*weights.form,
    draw:poisson.draw*weights.poisson+elo.draw*weights.elo+form.draw*weights.form,
    away:poisson.away*weights.poisson+elo.away*weights.elo+form.away*weights.form
  }),side=p=>["home","draw","away"].sort((a,b)=>p[b]-p[a])[0],componentSides={poisson:side(poisson),elo:side(elo),form:side(form)},directions=new Set(Object.values(componentSides)).size,maxDifference=Math.max(...["home","draw","away"].map(key=>Math.abs(poisson[key]-elo[key])),...["home","draw","away"].map(key=>Math.abs(poisson[key]-form[key]))),agreement=directions===3||maxDifference>=.18?"bajo":directions===2||maxDifference>=.11?"parcial":"total";
  return{version:"Sombra 0.1",status:"experimental",weights,probabilities:blend,components:{poisson,elo,form},componentSides,maxDifference,agreement,changesOfficial:false};
}

function buildStatisticalTrapDetector(home,away,r,shadow){
  const alerts=[],add=(severity,code,message)=>alerts.push({severity,code,message}),teamsToCheck=[home,away];
  teamsToCheck.forEach(team=>{
    const details=(team.details||[]).slice(0,10),sample=Math.min((team.matches||[]).length,10),friendlyRate=details.length?details.filter(x=>/friendly|amistoso/i.test(x.tournament||x.competition||"")).length/details.length:0;
    if(sample<6)add("high","small_sample",`${team.name}: solo ${sample} partidos válidos.`);
    else if(sample<10)add("medium","short_sample",`${team.name}: muestra incompleta (${sample}/10).`);
    if(details.length>=5&&friendlyRate>=.7)add("medium","friendlies",`${team.name}: ${Math.round(friendlyRate*100)}% de la muestra son amistosos.`);
    const ratedOpponents=details.map(x=>team.ratingMap?.[x.opponent]).filter(Number.isFinite),avgOpponent=ratedOpponents.length?ratedOpponents.reduce((s,x)=>s+x,0)/ratedOpponents.length:null,winRate=sample?team.matches.slice(0,10).filter(x=>x[0]>x[1]).length/sample:0;
    if(avgOpponent!==null&&avgOpponent<1450&&winRate>=.7)add("medium","weak_opponents",`${team.name}: buen registro reciente frente a rivales de Elo medio ${Math.round(avgOpponent)}.`);
    if((team.advancedMatches||0)<3)add("low","advanced_coverage",`${team.name}: poca cobertura partido a partido para córners y tarjetas.`);
  });
  const maxDifference=shadow.maxDifference;
  if(shadow.agreement==="bajo"||maxDifference>=.18)add("high","model_disagreement","Poisson, Elo y forma señalan direcciones diferentes.");
  else if(shadow.agreement==="parcial"||maxDifference>=.11)add("medium","model_disagreement","Los modelos coinciden solo parcialmente; conviene bajar la confianza.");
  if(!home.marketStats||!away.marketStats)add("medium","missing_markets","Falta el perfil completo de mercados de una selección.");
  if(r.confidenceComponents?.stability<.45)add("medium","volatile_form","Los resultados recientes presentan alta variación.");
  const top=[r.hp,r.dp,r.ap].sort((a,b)=>b-a);if(top[0]-top[1]<.06)add("medium","thin_edge","La ventaja 1X2 es menor a 6 puntos porcentuales.");
  const penalty=alerts.reduce((sum,x)=>sum+(x.severity==="high"?18:x.severity==="medium"?9:4),0),score=clamp(100-penalty,20,100),level=alerts.some(x=>x.severity==="high")?"alto":alerts.some(x=>x.severity==="medium")?"medio":"bajo";
  if(!alerts.length)add("low","no_major_flags","Sin sesgos estadísticos importantes detectados con los datos disponibles.");
  return{score,level,alerts,checkedAt:new Date().toISOString(),blocksAutomaticPromotion:level==="alto"};
}

function render(home,away,r){
  const fixture=selectedFixture&&selectedFixture.team1===home.name&&selectedFixture.team2===away.name?selectedFixture:localWorldCupData?.matches?.find(m=>m.team1===home.name&&m.team2===away.name&&!Array.isArray(m.score?.ft));
  const a=home.marketStats,b=away.marketStats,shadowEnsemble=buildShadowEnsemble(home,away,r),dataAudit=buildStatisticalTrapDetector(home,away,r,shadowEnsemble),statMarkets=buildStatMarkets(home,away),context=activeMatchContext(),referee=officialCatalog.find(x=>x.id===context.refereeId)||null;
  const refereeCards=context.refereeCards!==null&&context.refereeCards!==""?Number(context.refereeCards):NaN,refereeFouls=context.refereeFouls!==null&&context.refereeFouls!==""?Number(context.refereeFouls):NaN;
  currentPrediction={
    modelVersion:"2.7",competition:fixture?"World Cup 2026":manualMode?"Carga manual":"Partido internacional",home:home.name,away:away.name,matchDate:fixture?.date||null,dataCutoff:home.cutoffDate||fixture?.date||null,leakageProtected:Boolean(home.cutoffDate),confidence:r.confidence,confidenceScore:r.confidenceScore,confidenceFactors:r.confidenceFactors,confidenceComponents:r.confidenceComponents,matchContext:r.matchContext,
    fixture:fixture?{time:fixture.time||null,round:fixture.round||null,group:fixture.group||null,ground:fixture.ground||null,neutral:Boolean(r.neutral)}:null,marketOdds:fixture?.marketOdds||fixture?.sourceOdds?.average||null,
    score:{home:r.best.h,away:r.best.a,probability:r.best.p},
    probabilities:{home:r.hp,draw:r.dp,away:r.ap,over15:r.over15,over25:r.over,over35:r.over35,btts:r.btts,homeClean:r.homeClean,awayClean:r.awayClean,doubleChanceHome:r.dcHome,doubleChanceAway:r.dcAway,noDraw:r.noDraw},
    expectedGoals:{home:r.xh,away:r.xa},ratings:{home:r.ratingHome,away:r.ratingAway},shadowEnsemble,dataAudit,statMarkets,personnel:r.personnel,referee:referee?{id:referee.id,name:referee.name,association:referee.association,cardsPerMatch:refereeCards||null,foulsPerMatch:refereeFouls||null,source:context.refereeSource||referee.source}:null,
    footy:a&&b?{
      cornersExpected:(a.corners_avg+b.corners_avg)/2,cornersOver85:calibrateMarketProbability((a.corners_8_5plus+b.corners_8_5plus)/2,"corners"),
      cardsExpected:Number.isFinite(refereeCards)?((a.cards_avg+b.cards_avg)/2)*.7+refereeCards*.3:(a.cards_avg+b.cards_avg)/2,cardsOver25:calibrateMarketProbability((a.cards_2_5plus+b.cards_2_5plus)/2,"cards"),
      cornersLines:Object.fromEntries(["7_5","8_5","9_5","10_5","11_5","12_5","13_5"].map(line=>[line,calibrateMarketProbability((a[`corners_${line}plus`]+b[`corners_${line}plus`])/2,"corners")])),
      cardsLines:Object.fromEntries(["0_5","1_5","2_5","3_5","4_5","5_5","6_5"].map(line=>{const raw=calibrateMarketProbability((a[`cards_${line}plus`]+b[`cards_${line}plus`])/2,"cards"),baseline=(a.cards_avg+b.cards_avg)/2,adjusted=Number.isFinite(refereeCards)&&Number.isFinite(raw)?clamp(raw+(refereeCards-baseline)*.035,.05,.95):raw;return[line,adjusted]}))
    }:null
  };
  currentPrediction.officialPicks=buildOfficialPicks(currentPrediction);
  $("#results").classList.remove("hidden");
  $("#matchTitle").textContent=`${home.name} vs ${away.name}`;
  $("#sampleSize").textContent=`${home.matches.length+away.matches.length} partidos analizados`;
  $("#homeShort").textContent=home.name; $("#awayShort").textContent=away.name;
  $("#homeInitial").textContent=initials(home.name); $("#awayInitial").textContent=initials(away.name);
  $("#scoreHome").textContent=r.best.h; $("#scoreAway").textContent=r.best.a;
  $("#confidence").textContent=`${r.confidence} · ${r.confidenceScore}/100`;
  $("#goalsPickLabel").textContent=currentPrediction.officialPicks.goals?.label||"Línea de goles";$("#overProb").textContent=currentPrediction.officialPicks.goals?percent(currentPrediction.officialPicks.goals.probability):"—";
  $("#bttsPickLabel").textContent=currentPrediction.officialPicks.btts.label;$("#bttsProb").textContent=currentPrediction.officialPicks.btts.abstain?`Sí ${percent(r.btts)} · No ${percent(1-r.btts)}`:percent(currentPrediction.officialPicks.btts.probability);
  const leader=r.hp>r.ap&&r.hp>r.dp?`ventaja de ${home.name}`:r.ap>r.hp&&r.ap>r.dp?`ventaja de ${away.name}`:"un encuentro equilibrado";
  $("#predictionText").textContent=`El modelo detecta ${leader}, con ${r.xh.toFixed(2)} y ${r.xa.toFixed(2)} goles esperados respectivamente.`;
  const rows=[[home.name,r.hp,"home"],["Empate",r.dp,"draw"],[away.name,r.ap,"away"]];
  $("#probRows").innerHTML=rows.map(x=>`<div class="prob-row ${x[2]}"><div class="prob-label"><span>${x[0]}</span><b>${percent(x[1])}</b></div><div class="bar"><i style="width:${percent(x[1])}"></i></div></div>`).join("");
  $("#homeForm").innerHTML=formHtml(home,r.hs); $("#awayForm").innerHTML=formHtml(away,r.as);
  const advanced=(home.advancedMatches||0)+(away.advancedMatches||0);
  const affected=[...r.personnel.home.affected,...r.personnel.away.affected];
  $("#details").innerHTML=`Goles esperados: <b>${home.name} ${r.xh.toFixed(2)}</b> · <b>${away.name} ${r.xa.toFixed(2)}</b>.<br>El marcador mostrado es el más probable entre los que coinciden con la elección 1X2; el modal absoluto es ${r.modalScore.h}–${r.modalScore.a}.<br>Pesos: recencia 90% acumulativa; fuerza rival, forma, sede, descanso y situación del grupo.${affected.length?` <b>Ajuste de plantilla:</b> ${affected.map(x=>`${safeHtml(x.name)} (${PERSONNEL_STATUS[x.status]})`).join(", ")}.`:""}${referee?` <b>Ajuste arbitral:</b> ${safeHtml(referee.name)}${Number.isFinite(refereeCards)?`, ${refereeCards.toFixed(1)} tarjetas/partido`:""}${Number.isFinite(refereeFouls)?`, ${refereeFouls.toFixed(1)} faltas/partido`:""}.`:""}<br>Se evaluaron marcadores de 0–0 a 7–7 y se normalizaron sus probabilidades.${advanced?`<br>Además, ${advanced} partidos recientes incluyen estadísticas avanzadas conservadas: posesión, tiros, tarjetas, córners y formaciones.`:""}`;
  renderAdvancedMarkets(home,away);
  if(typeof renderDecisionSupport==="function")renderDecisionSupport(home,away,r);
  if(typeof updateBetLabForPrediction==="function")updateBetLabForPrediction();
  updateDecisionPanel();
  setAppTab("forecast",true);
}

function renderAdvancedMarkets(home,away){
  const panel=$("#advancedMarkets"),a=home.marketStats,b=away.marketStats,groups=[];
  const item=(label,value,note)=>[label,value,note];
  const addGroup=(title,items)=>{const valid=items.filter(x=>x&&x[1]!==null&&x[1]!==undefined);if(valid.length)groups.push([title,valid])};
  if(a&&b){
    const avg=key=>Number.isFinite(a[key])&&Number.isFinite(b[key])?(a[key]+b[key])/2:null;
    const pctItem=(label,key,kind=null)=>{const raw=avg(key),value=kind?calibrateMarketProbability(raw,kind):raw;return value===null?null:item(label,percent(value),kind?"Probabilidad calibrada":"Frecuencia histórica")};
    const numberItem=(label,key,note="Promedio del cruce")=>{const value=avg(key);return value===null?null:item(label,value.toFixed(2),note)};
    const teamPct=(team,name,label,key)=>Number.isFinite(team[key])?item(`${label} · ${name}`,percent(team[key]),`${team.played} partidos de ${name}`):null;
    const teamNumber=(team,name,label,key,digits=2)=>Number.isFinite(team[key])?item(`${label} · ${name}`,team[key].toFixed(digits),`${team.played} partidos de ${name}`):null;
    const goalLines=[["1_5","1.5"],["2_5","2.5"],["3_5","3.5"]];
    const cornerLines=["7_5","8_5","9_5","10_5","11_5","12_5","13_5"];
    const cardLines=["0_5","1_5","2_5","3_5","4_5","5_5","6_5"];

    addGroup("Perfil general de FootyStats",[
      item("PARTIDOS DE LA MUESTRA",`${a.played} + ${b.played}`,`${home.name} + ${away.name}`),
      numberItem("PUNTOS POR PARTIDO","ppg",`${home.name} ${a.ppg.toFixed(2)} · ${away.name} ${b.ppg.toFixed(2)}`),
      numberItem("GOLES TOTALES","goals_match_avg"),
      pctItem("AMBOS MARCAN","btts_rate")
    ]);
    addGroup("Goles y líneas over",[
      pctItem("MÁS DE 1.5 GOLES","goals_1_5plus"),
      pctItem("MÁS DE 2.5 GOLES","goals_2_5plus"),
      pctItem("MÁS DE 3.5 GOLES","goals_3_5plus"),
      numberItem("GOLES DEL EQUIPO","goals_avg","Promedio de ambos perfiles")
    ]);
    addGroup("Goles por selección",[
      teamNumber(a,home.name,"GOLES EN SUS PARTIDOS","goals_match_avg"),
      teamNumber(b,away.name,"GOLES EN SUS PARTIDOS","goals_match_avg"),
      ...goalLines.flatMap(([key,label])=>[
        teamPct(a,home.name,`MÁS DE ${label} GOLES`,`goals_${key}plus`),
        teamPct(b,away.name,`MÁS DE ${label} GOLES`,`goals_${key}plus`)
      ])
    ]);
    addGroup("Primer tiempo",[
      numberItem("GOLES 1.er TIEMPO","first_half_goals_ht avg"),
      pctItem("+0.5 EN 1.er TIEMPO","first_half_goals_0_5plus"),
      pctItem("+1.5 EN 1.er TIEMPO","first_half_goals_1_5plus"),
      pctItem("+2.5 EN 1.er TIEMPO","first_half_goals_2_5plus")
    ]);
    addGroup("Primer tiempo por selección",[
      teamNumber(a,home.name,"GOLES 1.er TIEMPO","first_half_goals_ht avg"),
      teamNumber(b,away.name,"GOLES 1.er TIEMPO","first_half_goals_ht avg"),
      ...[["0_5","0.5"],["1_5","1.5"],["2_5","2.5"]].flatMap(([key,label])=>[
        teamPct(a,home.name,`MÁS DE ${label} EN 1.er TIEMPO`,`first_half_goals_${key}plus`),
        teamPct(b,away.name,`MÁS DE ${label} EN 1.er TIEMPO`,`first_half_goals_${key}plus`)
      ])
    ]);
    addGroup("Porterías y producción ofensiva",[
      item(`PORTERÍA A CERO · ${home.name}`,percent(a.clean_sheet_rate),"Perfil histórico"),
      item(`PORTERÍA A CERO · ${away.name}`,percent(b.clean_sheet_rate),"Perfil histórico"),
      item(`SIN MARCAR · ${home.name}`,percent(a.failed_to_score_rate),"Perfil histórico"),
      item(`SIN MARCAR · ${away.name}`,percent(b.failed_to_score_rate),"Perfil histórico")
    ]);
    addGroup("Córners",[
      numberItem("CÓRNERS ESPERADOS","corners_avg"),
      ...cornerLines.map(line=>pctItem(`MÁS DE ${line.replace("_",".")} CÓRNERS`,`corners_${line}plus`,"corners"))
    ]);
    addGroup("Córners por selección",[
      teamNumber(a,home.name,"CÓRNERS EN SUS PARTIDOS","corners_avg",1),
      teamNumber(b,away.name,"CÓRNERS EN SUS PARTIDOS","corners_avg",1),
      ...cornerLines.flatMap(line=>[
        teamPct(a,home.name,`MÁS DE ${line.replace("_",".")} CÓRNERS`,`corners_${line}plus`),
        teamPct(b,away.name,`MÁS DE ${line.replace("_",".")} CÓRNERS`,`corners_${line}plus`)
      ])
    ]);
    addGroup("Tarjetas",[
      numberItem("TARJETAS ESPERADAS","cards_avg"),
      ...cardLines.map(line=>pctItem(`MÁS DE ${line.replace("_",".")} TARJETAS`,`cards_${line}plus`,"cards"))
    ]);
    addGroup("Tarjetas por selección",[
      teamNumber(a,home.name,"TARJETAS EN SUS PARTIDOS","cards_avg",1),
      teamNumber(b,away.name,"TARJETAS EN SUS PARTIDOS","cards_avg",1),
      ...cardLines.flatMap(line=>[
        teamPct(a,home.name,`MÁS DE ${line.replace("_",".")} TARJETAS`,`cards_${line}plus`),
        teamPct(b,away.name,`MÁS DE ${line.replace("_",".")} TARJETAS`,`cards_${line}plus`)
      ])
    ]);
  }
  if(home.fbref&&away.fbref){
    const sumRate=stat=>{const x=fbrefRate(home.fbref,stat),y=fbrefRate(away.fbref,stat);return Number.isFinite(x)&&Number.isFinite(y)?x+y:null};
    const shots=sumRate("shots"),sot=sumRate("shots_on_target"),fouls=sumRate("fouls");
    addGroup("Datos adicionales de FBref",[
      Number.isFinite(shots)?item("TIROS TOTALES",shots.toFixed(1),Number.isFinite(sot)?`${sot.toFixed(1)} al arco`:"Perfiles importados"):null,
      Number.isFinite(fouls)?item("FALTAS ESPERADAS",fouls.toFixed(1),"Perfiles importados"):null
    ]);
  }
  const statLabels={shots:"Tiros",shotsOnTarget:"Tiros al arco",fouls:"Faltas"};
  Object.entries(currentPrediction?.statMarkets||{}).forEach(([key,market])=>{
    if(!market?.lines?.length)return;const scopePick=scope=>market.lines.filter(x=>x.scope===scope&&x.probability>=.5).sort((a,b)=>Math.abs(a.probability-.68)-Math.abs(b.probability-.68)||b.probability-a.probability)[0]||null,totalPick=scopePick("total"),homePick=scopePick("home"),awayPick=scopePick("away");
    addGroup(`${statLabels[key]} · estimación por partidos`,[
      Number.isFinite(market.expectedTotal)?item(`${statLabels[key].toUpperCase()} ESPERADOS`,market.expectedTotal.toFixed(1),`${market.sample} observaciones con estadística`):null,
      Number.isFinite(market.homeExpected)?item(`${statLabels[key].toUpperCase()} · ${home.name}`,market.homeExpected.toFixed(1),"Estimación individual"):null,
      Number.isFinite(market.awayExpected)?item(`${statLabels[key].toUpperCase()} · ${away.name}`,market.awayExpected.toFixed(1),"Estimación individual"):null,
      totalPick?item("LÍNEA TOTAL",percent(totalPick.probability),`${totalPick.label} · n=${totalPick.sample}`):null,
      homePick?item(`LÍNEA · ${home.name}`,percent(homePick.probability),`${homePick.label} · n=${homePick.sample}`):null,
      awayPick?item(`LÍNEA · ${away.name}`,percent(awayPick.probability),`${awayPick.label} · n=${awayPick.sample}`):null
    ]);
  });
  if(!groups.length){panel.classList.add("hidden");return}
  panel.innerHTML=`<div class="advanced-title"><h3>Mercados estadísticos</h3><span>Totales del cruce y perfiles separados por selección · no garantizan resultados</span></div>${groups.map(group=>`<section class="market-section"><h4>${group[0]}</h4><div class="market-grid">${group[1].map(x=>`<div class="market-item"><span>${x[0]}</span><b>${x[1]}</b><small>${x[2]}</small></div>`).join("")}</div></section>`).join("")}`;
  panel.classList.remove("hidden");
}

function syncTournamentResultsFromHistory(){
  if(!localWorldCupData?.matches)return 0;let updated=0;const seen=new Set();
  const sameFixture=(record,match)=>{
    if(match.date!==record.matchDate)return false;
    if(match.team1===record.home&&match.team2===record.away)return true;
    if(typeof fixtureResolvedView==="function"){
      const resolved=fixtureResolvedView(match);
      return resolved?.team1===record.home&&resolved?.team2===record.away;
    }
    return false;
  };
  const latest=new Map();
  predictionHistory.filter(x=>x.actual&&x.matchDate).sort((a,b)=>new Date(a.actual.recordedAt||a.savedAt)-new Date(b.actual.recordedAt||b.savedAt)).forEach(record=>latest.set(`${record.matchDate}|${record.home}|${record.away}`,record));
  [...latest.values()].sort((a,b)=>String(a.matchDate||"").localeCompare(String(b.matchDate||""))||new Date(a.actual.recordedAt||a.savedAt)-new Date(b.actual.recordedAt||b.savedAt)).forEach(record=>{const key=`${record.matchDate}|${record.home}|${record.away}`;if(seen.has(key))return;seen.add(key);const match=localWorldCupData.matches.find(m=>sameFixture(record,m));if(match){const next=[record.actual.homeGoals,record.actual.awayGoals],current=match.score?.ft,historySource=String(match.score?.source||"").startsWith("Historial PronostiGol")||match.score?.source==="Registro manual",canUpdate=!Array.isArray(current)||historySource;if(canUpdate){const score={...(match.score||{}),ft:next,source:record.actual.source||"Historial PronostiGol"};if(record.actual.qualifiedSide)score.qualified=record.actual.qualifiedSide;if(Number.isFinite(record.actual.homePenalties)&&Number.isFinite(record.actual.awayPenalties))score.penalties=[record.actual.homePenalties,record.actual.awayPenalties];if(current?.[0]!==next[0]||current?.[1]!==next[1]||score.qualified!==match.score?.qualified||String(score.penalties)!==String(match.score?.penalties)){match.score=score;updated++}}}});return updated;
}
function tournamentResultKey(match){
  return [match?.date||"",match?.round||"",match?.team1||"",match?.team2||""].join("|");
}
function worldCupResultOverridesFromHistory(){
  if(!localWorldCupData?.matches)return [];
  const sameFixture=(record,match)=>{
    if(match.date!==record.matchDate)return false;
    if(match.team1===record.home&&match.team2===record.away)return true;
    if(typeof fixtureResolvedView==="function"){
      const resolved=fixtureResolvedView(match);
      return resolved?.team1===record.home&&resolved?.team2===record.away;
    }
    return false;
  };
  const byKey=new Map();
  const latest=new Map();
  predictionHistory.filter(x=>x.actual&&x.matchDate).sort((a,b)=>new Date(a.actual.recordedAt||a.savedAt)-new Date(b.actual.recordedAt||b.savedAt)).forEach(record=>latest.set(`${record.matchDate}|${record.home}|${record.away}`,record));
  [...latest.values()].sort((a,b)=>String(a.matchDate||"").localeCompare(String(b.matchDate||""))||new Date(a.actual.recordedAt||a.savedAt)-new Date(b.actual.recordedAt||b.savedAt)).forEach(record=>{
    const match=localWorldCupData.matches.find(m=>sameFixture(record,m));if(!match)return;
    const score={ft:[record.actual.homeGoals,record.actual.awayGoals],source:record.actual.source||"Historial PronostiGol"};
    if(record.actual.qualifiedSide)score.qualified=record.actual.qualifiedSide;
    if(Number.isFinite(record.actual.homePenalties)&&Number.isFinite(record.actual.awayPenalties))score.penalties=[record.actual.homePenalties,record.actual.awayPenalties];
    byKey.set(tournamentResultKey(match),{key:tournamentResultKey(match),date:match.date,round:match.round,team1:match.team1,team2:match.team2,home:record.home,away:record.away,score,updatedAt:record.actual.recordedAt||record.savedAt});
  });
  return [...byKey.values()];
}
function applyWorldCupResultOverrides(overrides){
  if(!localWorldCupData?.matches||!Array.isArray(overrides))return 0;
  let updated=0;
  overrides.forEach(item=>{
    const match=localWorldCupData.matches.find(m=>tournamentResultKey(m)===(item.key||[item.date||"",item.round||"",item.team1||"",item.team2||""].join("|")));
    if(!match||!Array.isArray(item.score?.ft))return;
    const current=match.score?.ft,score={...(match.score||{}),...item.score,source:item.score.source||"Historial PronostiGol"};
    if(current?.[0]!==score.ft[0]||current?.[1]!==score.ft[1]||match.score?.qualified!==score.qualified||String(match.score?.penalties)!==String(score.penalties)){
      match.score=score;updated++;
    }
  });
  return updated;
}
function persistWorldCupResultOverrides(){
  const overrides=worldCupResultOverridesFromHistory();
  localStorage.setItem("pg_worldcup_results",JSON.stringify(overrides));
  if(typeof saveSharedState==="function")saveSharedState("worldcup-results",overrides);
  return overrides.length;
}
function refreshTournamentAfterResult(){
  const updated=syncTournamentResultsFromHistory();persistWorldCupResultOverrides();if((updated||localWorldCupData)&&typeof renderTournamentHub==="function")renderTournamentHub();if(updated&&typeof refreshChronologicalLab==="function")refreshChronologicalLab();return updated;
}

function saveHistory(){
  localStorage.setItem("pg_prediction_history",JSON.stringify(predictionHistory));
  if(typeof onPredictionHistoryChanged==="function")onPredictionHistoryChanged();
  if(location.protocol!=="file:")fetch("/api/predictions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(predictionHistory)}).then(r=>r.json()).then(data=>{$("#databaseStatus").textContent=data.storage==="sqlserver"?"SQL Server conectado":"Respaldo local"}).catch(()=>{$("#databaseStatus").textContent="Respaldo local"});
}
function repairLegacyText(value){
  if(typeof value!=="string")return value;
  const replacements=[["sÐ","sí"],["SÐ","Sí"],["c®rners","córners"],["C®RNERS","CÓRNERS"],["cÃ³rners","córners"],["CÃ“RNERS","CÓRNERS"],["MÃ¡s","Más"],["mÃ¡s","más"],["MenÃºs","Menús"],["Ã¡","á"],["Ã©","é"],["Ã­","í"],["Ã³","ó"],["Ãº","ú"],["Ã±","ñ"],["Â·","·"],["â€“","–"],["â€”","—"]];
  return replacements.reduce((text,[bad,good])=>text.split(bad).join(good),value);
}
function repairLegacyObject(value){
  if(typeof value==="string")return repairLegacyText(value);if(!value||typeof value!=="object")return value;
  if(Array.isArray(value)){value.forEach((item,index)=>value[index]=repairLegacyObject(item));return value}
  Object.keys(value).forEach(key=>value[key]=repairLegacyObject(value[key]));return value;
}
function migratePredictionRecords(records=predictionHistory){
  let changed=0;records.forEach(record=>{
    const before=JSON.stringify(record);repairLegacyObject(record);const p=record.prediction;
    if(p?.score&&!Number.isFinite(p.score.probability)){
      const xh=Number(p.expectedGoals?.home),xa=Number(p.expectedGoals?.away),h=Number(p.score.home),a=Number(p.score.away);
      p.score.probability=Number.isFinite(xh)&&Number.isFinite(xa)&&Number.isInteger(h)&&Number.isInteger(a)?clamp(poisson(h,xh)*poisson(a,xa),.001,.99):null;
    }
    if(p?.officialPicks){const fallback=legacyOfficialPicks(p);Object.entries(p.officialPicks).forEach(([key,pick])=>{if(pick&&!Number.isFinite(pick.probability)&&Number.isFinite(fallback[key]?.probability))pick.probability=fallback[key].probability})}
    if(before!==JSON.stringify(record))changed++;
  });return changed;
}
async function loadDatabaseHistory(){
  if(location.protocol==="file:")return;
    try{const response=await fetch("/api/predictions"),data=await response.json();if(Array.isArray(data.predictions)&&data.predictions.length){const merged=new Map(predictionHistory.map(x=>[x.id,x]));data.predictions.forEach(x=>merged.set(x.id,x));predictionHistory=[...merged.values()].sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt));const repaired=migratePredictionRecords();localStorage.setItem("pg_prediction_history",JSON.stringify(predictionHistory));renderPredictionHistory();refreshTournamentAfterResult();if(typeof onPredictionHistoryChanged==="function")onPredictionHistoryChanged();if(repaired)saveHistory()}$("#databaseStatus").textContent=data.storage==="sqlserver"?"SQL Server conectado":"Respaldo local"}catch(_){$("#databaseStatus").textContent="Almacenamiento local"}
}
function outcome(h,a){return h>a?"home":h<a?"away":"draw"}
function predictionOutcome(p){return Object.entries({home:p.probabilities.home,draw:p.probabilities.draw,away:p.probabilities.away}).sort((a,b)=>b[1]-a[1])[0][0]}
function legacyOfficialPicks(p){
  const resultSide=predictionOutcome(p),resultLabels={home:`${p.home} gana`,draw:"Empate",away:`${p.away} gana`},over25=p.probabilities.over25>=.5,btts=p.probabilities.btts>=.5,corners=p.footy?.cornersOver85>=.5,cards=p.footy?.cardsOver25>=.5;
  return{
    winner:{market:"result",side:resultSide,probability:p.probabilities[resultSide],label:resultLabels[resultSide]},
    exact:{market:"exact",homeGoals:p.score.home,awayGoals:p.score.away,probability:p.score.probability,label:`Marcador ${p.score.home}–${p.score.away}`},
    goals:{market:"goals",stat:"goals",side:over25?"over":"under",threshold:2.5,probability:over25?p.probabilities.over25:1-p.probabilities.over25,label:`${over25?"Más":"Menos"} de 2.5 goles`},
    btts:{market:"btts",side:btts?"yes":"no",probability:btts?p.probabilities.btts:1-p.probabilities.btts,label:`Ambos marcan: ${btts?"sí":"no"}`},
    corners:p.footy?{market:"corners",stat:"corners",side:corners?"over":"under",threshold:8.5,probability:corners?p.footy.cornersOver85:1-p.footy.cornersOver85,label:`${corners?"Más":"Menos"} de 8.5 córners`}:null,
    cards:p.footy?{market:"cards",stat:"cards",side:cards?"over":"under",threshold:2.5,probability:cards?p.footy.cardsOver25:1-p.footy.cardsOver25,label:`${cards?"Más":"Menos"} de 2.5 tarjetas`,experimental:true}:null
  };
}
function statFieldName(stat){
  return{corners:"Corners",cards:"Cards",shots:"Shots",shots_on_target:"ShotsOnTarget",fouls:"Fouls"}[stat]||null;
}
function totalStatField(stat){
  return{corners:"corners",cards:"cards",shots:"shots",shots_on_target:"shotsOnTarget",fouls:"fouls"}[stat]||null;
}
function actualStatValue(actual,stat,scope="total"){
  if(stat==="goals"){
    if(scope==="home")return actual.homeGoals;
    if(scope==="away")return actual.awayGoals;
    return actual.homeGoals+actual.awayGoals;
  }
  const base=statFieldName(stat),totalField=totalStatField(stat);
  if(!base||!totalField)return null;
  if(scope==="home")return Number.isFinite(actual[`home${base}`])?actual[`home${base}`]:null;
  if(scope==="away")return Number.isFinite(actual[`away${base}`])?actual[`away${base}`]:null;
  if(Number.isFinite(actual[totalField]))return actual[totalField];
  const home=actual[`home${base}`],away=actual[`away${base}`];
  return Number.isFinite(home)&&Number.isFinite(away)?home+away:null;
}
function officialPickResult(pick,actual){
  if(!pick)return null;if(pick.market==="result")return outcome(actual.homeGoals,actual.awayGoals)===pick.side;
  if(pick.market==="exact")return actual.homeGoals===pick.homeGoals&&actual.awayGoals===pick.awayGoals;
  if(pick.market==="btts"){if(pick.side==="abstain"||pick.abstain)return null;return (actual.homeGoals>0&&actual.awayGoals>0)===(pick.side==="yes")}
  const value=actualStatValue(actual,pick.stat,pick.scope||"total");if(!Number.isFinite(value))return null;return pick.side==="over"?value>pick.threshold:value<pick.threshold;
}
function evaluateRecord(record){
  if(!record.actual)return null;
  const picks=record.prediction.officialPicks||legacyOfficialPicks(record.prediction),a=record.actual;
  return{winner:officialPickResult(picks.winner,a),exact:officialPickResult(picks.exact,a),over25:officialPickResult(picks.goals,a),btts:officialPickResult(picks.btts,a),corners:officialPickResult(picks.corners,a),cards:officialPickResult(picks.cards,a),shots:officialPickResult(picks.shots,a),shotsOnTarget:officialPickResult(picks.shotsOnTarget,a),fouls:officialPickResult(picks.fouls,a),picks};
}
function rateFor(records,key){const values=records.map(evaluateRecord).filter(Boolean).map(x=>x[key]).filter(x=>x!==null);return {hits:values.filter(Boolean).length,total:values.length,rate:values.length?values.filter(Boolean).length/values.length:null}}
function metricCard(label,data){return `<div class="history-metric"><span>${label}</span><b>${data.rate===null?"—":percent(data.rate)}</b><small>${data.total?`${data.hits} de ${data.total}`:"Sin muestra"}</small></div>`}
function resultBadge(pick,value){if(!pick)return "";const probability=Number.isFinite(pick.probability)?percent(pick.probability):"probabilidad no disponible";if(pick.abstain||pick.side==="abstain")return `<i class="result-badge neutral">○ ${repairLegacyText(pick.label)} · no apostar</i>`;if(value===null)return `<i class="result-badge neutral">○ ${repairLegacyText(pick.label)} · falta dato real</i>`;return `<i class="result-badge ${value?"hit":"miss"}">${value?"✓":"×"} ${repairLegacyText(pick.label)} · ${probability}</i>`}
function evaluationBadges(e){
  if(!e)return "";
  const order=[["winner","winner"],["exact","exact"],["goals","over25"],["btts","btts"],["corners","corners"],["cards","cards"],["shots","shots"],["shotsOnTarget","shotsOnTarget"],["fouls","fouls"]];
  return `<div class="evaluation-badges">${order.map(([pickKey,resultKey])=>resultBadge(e.picks[pickKey],e[resultKey])).join("")}</div>`;
}
function actualStatsSummary(actual){
  const item=(label,total,home,away)=>Number.isFinite(total)?`${label} ${total}${Number.isFinite(home)&&Number.isFinite(away)?` (${home}-${away})`:""}`:null;
  const penalties=Number.isFinite(actual.homePenalties)&&Number.isFinite(actual.awayPenalties)?`Penales ${actual.homePenalties}-${actual.awayPenalties}`:null;
  const qualifier=actual.qualifiedSide?`Clasificó ${actual.qualifiedSide==="home"?"local":"visitante"}`:null;
  return [
    penalties,qualifier,
    item("Córners",actual.corners,actual.homeCorners,actual.awayCorners),
    item("Tarjetas",actual.cards,actual.homeCards,actual.awayCards),
    item("Tiros",actual.shots,actual.homeShots,actual.awayShots),
    item("Al arco",actual.shotsOnTarget,actual.homeShotsOnTarget,actual.awayShotsOnTarget),
    item("Faltas",actual.fouls,actual.homeFouls,actual.awayFouls)
  ].filter(Boolean).join(" · ");
}
function statSplitInputs(record){
  const stats=[["Córners","Corners"],["Tarjetas","Cards"],["Tiros","Shots"],["Tiros al arco","ShotsOnTarget"],["Faltas","Fouls"]];
  return `<div class="actual-split"><div class="actual-split-head"><span>Estadísticas por equipo</span><small>El sistema suma el total automáticamente</small></div>${stats.map(([label,key])=>`<div class="actual-split-row"><b>${label}</b><label>${safeHtml(record.home)}<input name="home${key}" type="number" min="0" step="1" placeholder="Opcional"></label><label>${safeHtml(record.away)}<input name="away${key}" type="number" min="0" step="1" placeholder="Opcional"></label></div>`).join("")}</div>`;
}
function isKnockoutRecord(record){return !!record?.prediction?.fixture?.round&&!/matchday/i.test(record.prediction.fixture.round)}
function knockoutInputs(record){
  if(!isKnockoutRecord(record))return "";
  return `<div class="actual-split knockout-inputs"><div class="actual-split-head"><span>Eliminatoria</span><small>Si empatan, indica quién clasificó por penales</small></div><div class="actual-split-row"><b>Penales</b><label>${safeHtml(record.home)}<input name="homePenalties" type="number" min="0" step="1" placeholder="Opcional"></label><label>${safeHtml(record.away)}<input name="awayPenalties" type="number" min="0" step="1" placeholder="Opcional"></label></div><label class="qualified-select"><span>Clasificó</span><select name="qualifiedSide"><option value="">Solo si hubo empate</option><option value="home">${safeHtml(record.home)}</option><option value="away">${safeHtml(record.away)}</option></select></label></div>`;
}
function resultExtraInputs(record){return `${knockoutInputs(record)}${statSplitInputs(record)}`}
function formatSavedDate(value){return new Intl.DateTimeFormat("es",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}
function latestWorldCupOverridesCount(){
  try{const local=JSON.parse(localStorage.getItem("pg_worldcup_results")||"[]");return Array.isArray(local)?local.length:0}catch(_){return 0}
}
function systemHealthItems(){
  const completed=predictionHistory.filter(x=>x.actual).length,pending=predictionHistory.filter(x=>!x.actual).length;
  const wcLoaded=!!localWorldCupData?.matches?.length,wcCompleted=wcLoaded?localWorldCupData.matches.filter(m=>Array.isArray(m.score?.ft)).length:0;
  const bracketReady=wcLoaded&&typeof buildResolvedBracket==="function"?buildResolvedBracket().matches.filter(m=>Array.isArray(m.score?.ft)).length:0;
  const sqlText=$("#databaseStatus")?.textContent||"Almacenamiento local";
  return [
    ["Mundial",wcLoaded?"OK":"Pendiente",wcLoaded?`${localWorldCupData.matches.length} partidos`:"Carga Mundial incluido",wcLoaded],
    ["Historial",predictionHistory.length?"OK":"Vacio",`${predictionHistory.length} guardados`,!!predictionHistory.length],
    ["SQL / respaldo",sqlText.includes("SQL")?"OK":"Local",sqlText,sqlText.includes("SQL")],
    ["Resultados",completed?"OK":"Pendiente",`${completed} evaluados · ${pending} pendientes`,!!completed],
    ["Partidos actualizados",wcLoaded?"OK":"Pendiente",`${wcCompleted} con marcador`,wcLoaded],
    ["Cuadro",bracketReady?"OK":"Pendiente",`${bracketReady} eliminatorias con marcador`,!!bracketReady],
    ["Overrides Mundial",latestWorldCupOverridesCount()?"OK":"Pendiente",`${latestWorldCupOverridesCount()} guardados`,!!latestWorldCupOverridesCount()],
    ["Modo jugable",playableOnlyMode?"Activo":"Normal",playableOnlyMode?"filtra picks débiles":"muestra todo",playableOnlyMode]
  ];
}
function renderSystemControlPanel(){
  const grid=$("#systemHealthGrid"),status=$("#systemControlStatus");if(!grid)return;
  const items=systemHealthItems(),ok=items.filter(x=>x[3]).length;
  if(status)status.textContent=`${ok}/${items.length} OK`;
  grid.innerHTML=items.map(([label,state,detail,good])=>`<div class="system-health ${good?"ok":"warn"}"><span>${safeHtml(label)}</span><b>${safeHtml(state)}</b><small>${safeHtml(detail)}</small></div>`).join("");
  const toggle=$("#globalPlayableOnly");if(toggle)toggle.checked=playableOnlyMode;
}
function recalculateEverything(){
  const updated=refreshTournamentAfterResult();
  renderPredictionHistory();
  if(typeof renderTournamentHub==="function"&&localWorldCupData)renderTournamentHub();
  if(typeof refreshChronologicalLab==="function")refreshChronologicalLab();
  if(typeof updateDecisionPanel==="function")updateDecisionPanel();
  renderSystemControlPanel();
  $("#message")?.classList.add("success");showMessage(`Recalculado: ${updated} marcador(es) aplicados al Mundial y paneles actualizados.`);
}
function csvCell(value){return `"${String(value??"").replace(/"/g,'""')}"`}
function exportDayReport(){
  const date=$("#fixtureDate")?.value||new Date().toLocaleDateString("en-CA",{timeZone:"America/Lima"});
  const rows=[["Fecha","Partido","Estado","Pronostico","Resultado","Picks"]];
  const records=predictionHistory.filter(r=>r.matchDate===date);
  const fixtures=(localWorldCupData?.matches||[]).filter(m=>m.date===date);
  fixtures.forEach(m=>{
    const view=typeof fixtureResolvedView==="function"?fixtureResolvedView(m):{team1:m.team1,team2:m.team2};
    const record=records.find(r=>r.home===view.team1&&r.away===view.team2);
    rows.push([date,`${view.team1} vs ${view.team2}`,Array.isArray(m.score?.ft)?"Finalizado":"Pendiente",record?`${record.prediction?.score?.home}-${record.prediction?.score?.away}`:"",Array.isArray(m.score?.ft)?`${m.score.ft[0]}-${m.score.ft[1]}`:record?.actual?`${record.actual.homeGoals}-${record.actual.awayGoals}`:"",record?.prediction?.officialPicks?Object.values(record.prediction.officialPicks).filter(Boolean).map(x=>repairLegacyText(x.label)).join(" | "):""]);
  });
  records.filter(r=>!fixtures.some(m=>{const view=typeof fixtureResolvedView==="function"?fixtureResolvedView(m):{team1:m.team1,team2:m.team2};return r.home===view.team1&&r.away===view.team2})).forEach(r=>rows.push([date,`${r.home} vs ${r.away}`,r.actual?"Evaluado":"Pendiente",`${r.prediction?.score?.home}-${r.prediction?.score?.away}`,r.actual?`${r.actual.homeGoals}-${r.actual.awayGoals}`:"",r.prediction?.officialPicks?Object.values(r.prediction.officialPicks).filter(Boolean).map(x=>repairLegacyText(x.label)).join(" | "):""]));
  const csv=rows.map(row=>row.map(csvCell).join(",")).join("\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`pronostigol_${date}.csv`;a.click();URL.revokeObjectURL(url);
}
function recordAuditSummary(record,e){
  if(!record.actual||!e)return "";
  const misses=Object.entries({Ganador:e.winner,Marcador:e.exact,Goles:e.over25,BTTS:e.btts,Corners:e.corners,Tarjetas:e.cards,Tiros:e.shots,"Tiros al arco":e.shotsOnTarget,Faltas:e.fouls}).filter(([,v])=>v===false).map(([k])=>k);
  const hits=Object.entries({Ganador:e.winner,Marcador:e.exact,Goles:e.over25,BTTS:e.btts,Corners:e.corners,Tarjetas:e.cards,Tiros:e.shots,"Tiros al arco":e.shotsOnTarget,Faltas:e.fouls}).filter(([,v])=>v===true).map(([k])=>k);
  const notes=[];
  if(misses.length)notes.push(`Revisar: falló ${misses.slice(0,4).join(", ")}.`);
  if(hits.length)notes.push(`Bien leído: acertó ${hits.slice(0,4).join(", ")}.`);
  if(record.prediction?.dataAudit?.alerts?.length)notes.push(`Alertas previas: ${record.prediction.dataAudit.alerts.slice(0,2).map(x=>x.message).join(" / ")}`);
  if(!notes.length)notes.push("Resultado registrado sin señales suficientes para auditoría.");
  return `<div class="post-audit"><b>Lectura post-partido</b>${notes.map(x=>`<span>${safeHtml(x)}</span>`).join("")}</div>`;
}
function recordPassesHistoryFilter(record){
  if(historyFilter==="pending")return !record.actual;
  if(historyFilter==="done")return !!record.actual;
  if(historyFilter==="knockout")return isKnockoutRecord(record);
  if(historyFilter==="hits"||historyFilter==="misses"){
    const e=evaluateRecord(record);if(!e)return false;
    const values=[e.winner,e.over25,e.btts,e.corners,e.cards,e.shots,e.shotsOnTarget,e.fouls].filter(x=>x!==null);
    const rate=values.length?values.filter(Boolean).length/values.length:0;
    return historyFilter==="hits"?rate>=.6:rate<.6;
  }
  return true;
}
function renderPredictionHistory(){
  const completed=predictionHistory.filter(x=>x.actual);
  $("#historyCount").textContent=`${predictionHistory.length} guardado${predictionHistory.length===1?"":"s"}`;
  $("#historySummary").innerHTML=[metricCard("GANADOR",rateFor(completed,"winner")),metricCard("MARCADOR EXACTO",rateFor(completed,"exact")),metricCard("LÍNEA DE GOLES",rateFor(completed,"over25")),metricCard("AMBOS MARCAN",rateFor(completed,"btts")),metricCard("LÍNEA DE CÓRNERS",rateFor(completed,"corners")),metricCard("LÍNEA DE TARJETAS",rateFor(completed,"cards")),metricCard("LÍNEA DE TIROS",rateFor(completed,"shots")),metricCard("TIROS AL ARCO",rateFor(completed,"shotsOnTarget")),metricCard("LÍNEA DE FALTAS",rateFor(completed,"fouls"))].join("");
  if(!predictionHistory.length){$("#historyList").innerHTML='<div class="history-empty">Todavía no hay pronósticos guardados. Genera uno y guárdalo antes del partido.</div>';return}
  $("#historyList").innerHTML=predictionHistory.map(record=>{
    const p=record.prediction,e=evaluateRecord(record),actual=record.actual;
    const savedDay=(record.savedAt||"").slice(0,10),auditLabel=!record.matchDate?"":savedDay>record.matchDate?'<i class="audit-badge retro">RETROSPECTIVO</i>':savedDay<record.matchDate?'<i class="audit-badge forward">PREVIO AL PARTIDO</i>':'<i class="audit-badge same">MISMO DÍA</i>',modelLabel=`<i class="audit-badge model">MODELO ${p.modelVersion||"ANTERIOR"}${p.officialPicks?" · LÍNEAS DINÁMICAS":" · LÍNEAS FIJAS"}</i>`;
    const predicted=`${p.score.home}–${p.score.away}`;
    const probs=`${percent(p.probabilities.home)} · ${percent(p.probabilities.draw)} · ${percent(p.probabilities.away)}`;
    const evaluation=e?evaluationBadges(e):"";
    const statsSummary=actualStatsSummary(actual||{});
    const resultArea=actual?`<div class="actual-result"><span>Resultado registrado</span><b>${actual.homeGoals}–${actual.awayGoals}</b>${statsSummary?`<small>${statsSummary}</small>`:""}</div>${evaluation}`:`<form class="actual-form actual-form-split" data-id="${record.id}"><label class="score-input"><span>Resultado real</span><input name="homeGoals" type="number" min="0" step="1" required placeholder="${record.home}"><b>–</b><input name="awayGoals" type="number" min="0" step="1" required placeholder="${record.away}"></label>${statSplitInputs(record)}<button type="submit">Evaluar resultado</button></form>`;
    return `<article class="history-card card"><div class="history-card-head"><div><small>${record.matchDate?`PARTIDO ${record.matchDate}`:"GUARDADO "+formatSavedDate(record.savedAt)} ${auditLabel} ${modelLabel}</small><h3>${record.home} vs ${record.away}</h3></div><button class="delete-prediction" data-id="${record.id}" title="Eliminar registro">Eliminar</button></div><div class="frozen-prediction"><div><span>MARCADOR PREVISTO</span><b>${predicted}</b></div><div><span>1 · X · 2</span><b>${probs}</b></div><div><span>GOLES ESPERADOS</span><b>${p.expectedGoals.home.toFixed(2)} · ${p.expectedGoals.away.toFixed(2)}</b></div></div>${resultArea}</article>`;
  }).join("");
  document.querySelectorAll(".actual-form").forEach(form=>{
    const record=predictionHistory.find(x=>x.id===form.dataset.id);
    const score=form.querySelector(".score-input");
    if(record&&score&&isKnockoutRecord(record))score.insertAdjacentHTML("afterend",knockoutInputs(record));
  });
}
function renderPredictionHistory(){
  const completed=predictionHistory.filter(x=>x.actual),visibleRecords=predictionHistory.filter(recordPassesHistoryFilter);
  $("#historyCount").textContent=`${predictionHistory.length} guardado${predictionHistory.length===1?"":"s"}`;
  $("#historySummary").innerHTML=[metricCard("GANADOR",rateFor(completed,"winner")),metricCard("MARCADOR EXACTO",rateFor(completed,"exact")),metricCard("LÍNEA DE GOLES",rateFor(completed,"over25")),metricCard("AMBOS MARCAN",rateFor(completed,"btts")),metricCard("LÍNEA DE CÓRNERS",rateFor(completed,"corners")),metricCard("LÍNEA DE TARJETAS",rateFor(completed,"cards")),metricCard("LÍNEA DE TIROS",rateFor(completed,"shots")),metricCard("TIROS AL ARCO",rateFor(completed,"shotsOnTarget")),metricCard("LÍNEA DE FALTAS",rateFor(completed,"fouls"))].join("");
  document.querySelectorAll(".history-filter").forEach(button=>button.classList.toggle("active",button.dataset.historyFilter===historyFilter));
  if(!predictionHistory.length){$("#historyList").innerHTML='<div class="history-empty">Todavía no hay pronósticos guardados. Genera uno y guárdalo antes del partido.</div>';renderSystemControlPanel();return}
  if(!visibleRecords.length){$("#historyList").innerHTML='<div class="history-empty">No hay registros para este filtro.</div>';renderSystemControlPanel();return}
  $("#historyList").innerHTML=visibleRecords.map(record=>{
    const p=record.prediction,e=evaluateRecord(record),actual=record.actual;
    const savedDay=(record.savedAt||"").slice(0,10),auditLabel=!record.matchDate?"":savedDay>record.matchDate?'<i class="audit-badge retro">RETROSPECTIVO</i>':savedDay<record.matchDate?'<i class="audit-badge forward">PREVIO AL PARTIDO</i>':'<i class="audit-badge same">MISMO DÍA</i>',modelLabel=`<i class="audit-badge model">MODELO ${p.modelVersion||"ANTERIOR"}${p.officialPicks?" · LÍNEAS DINÁMICAS":" · LÍNEAS FIJAS"}</i>`;
    const predicted=`${p.score.home}–${p.score.away}`;
    const probs=`${percent(p.probabilities.home)} · ${percent(p.probabilities.draw)} · ${percent(p.probabilities.away)}`;
    const evaluation=e?evaluationBadges(e):"",statsSummary=actualStatsSummary(actual||{});
    const resultArea=actual?`<div class="actual-result"><span>Resultado registrado</span><b>${actual.homeGoals}–${actual.awayGoals}</b>${statsSummary?`<small>${statsSummary}</small>`:""}</div>${evaluation}${recordAuditSummary(record,e)}`:`<form class="actual-form actual-form-split" data-id="${record.id}"><label class="score-input"><span>Resultado real</span><input name="homeGoals" type="number" min="0" step="1" required placeholder="${safeHtml(record.home)}"><b>–</b><input name="awayGoals" type="number" min="0" step="1" required placeholder="${safeHtml(record.away)}"></label>${statSplitInputs(record)}<button type="submit">Evaluar resultado</button></form>`;
    return `<article class="history-card card"><div class="history-card-head"><div><small>${record.matchDate?`PARTIDO ${record.matchDate}`:"GUARDADO "+formatSavedDate(record.savedAt)} ${auditLabel} ${modelLabel}</small><h3>${safeHtml(record.home)} vs ${safeHtml(record.away)}</h3></div><button class="delete-prediction" data-id="${record.id}" title="Eliminar registro">Eliminar</button></div><div class="frozen-prediction"><div><span>MARCADOR PREVISTO</span><b>${predicted}</b></div><div><span>1 · X · 2</span><b>${probs}</b></div><div><span>GOLES ESPERADOS</span><b>${p.expectedGoals.home.toFixed(2)} · ${p.expectedGoals.away.toFixed(2)}</b></div></div>${resultArea}</article>`;
  }).join("");
  document.querySelectorAll(".actual-form").forEach(form=>{const record=predictionHistory.find(x=>x.id===form.dataset.id),score=form.querySelector(".score-input");if(record&&score&&isKnockoutRecord(record))score.insertAdjacentHTML("afterend",knockoutInputs(record))});
  renderSystemControlPanel();
}
function autoEvaluateWorldCupHistory(){
  let updated=0;
  predictionHistory.forEach(record=>{
    if(record.actual||!record.matchDate)return;
    const match=localWorldCupData?.matches?.find(m=>m.date===record.matchDate&&m.team1===record.home&&m.team2===record.away&&Array.isArray(m.score?.ft));
    if(match){record.actual={homeGoals:match.score.ft[0],awayGoals:match.score.ft[1],corners:null,cards:null,source:"Mundial incluido"};updated++}
  });
  if(updated){saveHistory();renderPredictionHistory()}
  return updated;
}

async function api(path){
  if(location.protocol==="file:"){
    throw new Error("La aplicación se abrió como archivo. Ciérrala, ejecuta INICIAR_PRONOSTIGOL.bat y entra desde http://localhost:8000");
  }
  const international=path.startsWith("/api/international/");
  const storageKey=international?"pg_international_key":"pg_club_key";
  const key=$("#apiKey").value.trim()||sessionStorage.getItem(storageKey)||"";
  if(key)sessionStorage.setItem(storageKey,key);
  let res;
  try{res=await fetch(path,{headers:{"X-API-Key":key}})}
  catch(_){throw new Error("No se encuentra el servidor local. Ejecuta INICIAR_PRONOSTIGOL.bat y mantén abierta su ventana.")}
  const data=await res.json();
  if(!res.ok)throw new Error(data.message||data.error||`Error ${res.status}`); return data;
}
function showMessage(text){$("#message").textContent=text;$("#message").classList.remove("hidden")}

$("#loadLocalWorldCup").onclick=async()=>{
  try{
    if(location.protocol==="file:")throw new Error("Ejecuta INICIAR_PRONOSTIGOL.bat para cargar los archivos del Mundial.");
    const [groupsRes,matchesRes,historyRes,footyRes,enrichedRes,oddsRes,playersRes,officialsRes,refereesRes]=await Promise.all([fetch("/data/worldcup.groups.json"),fetch("/data/worldcup.json"),fetch("/data/international_history.json"),fetch("/data/footystats_profiles.json"),fetch("/data/worldcup_matches_enriched.json"),fetch("/data/worldcup_odds_snapshot.json"),fetch("/data/players.json"),fetch("/data/officials.json"),fetch("/data/euro_referee_profiles.json")]);
    if(!groupsRes.ok||!matchesRes.ok||!historyRes.ok||!footyRes.ok||!enrichedRes.ok||!oddsRes.ok||!playersRes.ok||!officialsRes.ok||!refereesRes.ok)throw new Error("No se encontraron todos los archivos locales del Mundial.");
    const groups=await groupsRes.json(),matchData=await matchesRes.json(),history=await historyRes.json(),footy=await footyRes.json(),enriched=await enrichedRes.json(),oddsSnapshot=await oddsRes.json(),players=await playersRes.json(),officials=await officialsRes.json(),referees=await refereesRes.json();
    playerCatalog=players.players||[];officialCatalog=officials.officials||[];refereeProfiles=referees.referees||[];
    applyEnrichedWorldCupData(matchData,enriched,oddsSnapshot);localWorldCupData={...matchData,history,footy,enriched,oddsSnapshot};teamRatings=buildEloRatings(history);manualMode=false;
    const savedWorldCupResults=await loadSharedState("worldcup-results");
    let localWorldCupResults=[];try{localWorldCupResults=JSON.parse(localStorage.getItem("pg_worldcup_results")||"[]")}catch(_){localWorldCupResults=[]}
    applyWorldCupResultOverrides(Array.isArray(savedWorldCupResults)&&savedWorldCupResults.length?savedWorldCupResults:localWorldCupResults);
    $("#manualPanel").classList.add("hidden");$("#apiPanel").classList.add("hidden");$(".teams").classList.remove("hidden");
    teams=groups.groups.flatMap(g=>g.teams.map(name=>({id:name,name,group:g.name})));
    fillTeamSelectors(teams);
    syncTournamentResultsFromHistory();persistWorldCupResultOverrides();
    const names=new Set(teams.map(t=>t.name));
    const today=new Date().toISOString().slice(0,10);
    const scheduled=matchData.matches.filter(m=>!m.score&&names.has(m.team1)&&names.has(m.team2)).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const upcoming=scheduled.find(m=>m.date>=today)||scheduled[0];
    if(upcoming){$("#homeTeam").value=upcoming.team1;$("#awayTeam").value=upcoming.team2;selectedFixture=fixtureContext(upcoming)}
    renderPrematchPanel();
    const completed=matchData.matches.filter(m=>Array.isArray(m.score?.ft)).length;
    const autoEvaluated=autoEvaluateWorldCupHistory();
    if(typeof initializeTournamentHub==="function")initializeTournamentHub();
    if(typeof refreshChronologicalLab==="function")refreshChronologicalLab();
    $("#sourceStatus").textContent=`Mundial · ${history.teams_with_10}/48 historiales · ${enriched.qualifiers.length} eliminatorias · ${oddsSnapshot.matches.filter(x=>Number.isFinite(x.homeOdds)).length} cuotas`;
    $("#message").classList.add("success");
    showMessage((upcoming?`Historial automático cargado para ${history.teams_with_10} selecciones. Próximo cruce: ${upcoming.team1} vs ${upcoming.team2}.`:`Datos cargados: ${history.teams_with_10} historiales completos y ${completed} resultados del Mundial.`)+(autoEvaluated?` ${autoEvaluated} pronóstico pendiente fue evaluado automáticamente.`:""));
  }catch(e){$("#message").classList.remove("success");showMessage(e.message)}
};

$("#toggleApi").onclick=()=>{setManualMode(false);$("#apiPanel").classList.remove("hidden")};
$("#toggleManual").onclick=()=>setManualMode(!manualMode);
$("#toggleFbref").onclick=()=>$("#fbrefPanel").classList.toggle("hidden");
$("#fbrefFiles").addEventListener("change",async e=>{
  try{
    let imported=0;
    for(const file of e.target.files){
      const parsed=parseFbrefHtml(await file.text(),file.name);
      const profile=fbrefProfiles[parsed.team]||{team:parsed.team,seasons:{}};
      profile.seasons[parsed.season]={matches:parsed.matches,totals:parsed.totals};
      fbrefProfiles[parsed.team]=profile;imported++;
    }
    localStorage.setItem("pg_fbref_profiles",JSON.stringify(fbrefProfiles));saveSharedState("fbref-profiles",fbrefProfiles);updateFbrefStatus();
    $("#message").classList.add("success");showMessage(`${imported} archivo(s) FBref importado(s) correctamente. Los datos quedan guardados en este navegador.`);
  }catch(error){$("#message").classList.remove("success");showMessage(error.message)}
});
$("#clearFbref").onclick=()=>{fbrefProfiles={};localStorage.removeItem("pg_fbref_profiles");saveSharedState("fbref-profiles",fbrefProfiles);updateFbrefStatus()};
document.querySelector(".app-tabs")?.addEventListener("click",event=>{const button=event.target.closest(".app-tab");if(!button)return;if(button.dataset.tab==="value")updateDecisionPanel();setAppTab(button.dataset.tab,true)});
$("#decisionMarket")?.addEventListener("change",()=>{$("#decisionLineMatch").checked=false;renderDecisionCalculator()});
$("#decisionOdds")?.addEventListener("input",renderDecisionCalculator);
$("#decisionLineMatch")?.addEventListener("change",renderDecisionCalculator);
setAppTab("matches");
updateFbrefStatus();
const repairedLegacyRecords=migratePredictionRecords();if(repairedLegacyRecords)localStorage.setItem("pg_prediction_history",JSON.stringify(predictionHistory));
renderPredictionHistory();
loadDatabaseHistory();
loadSharedState("fbref-profiles").then(value=>{if(value&&typeof value==="object"&&Object.keys(value).length)fbrefProfiles={...value,...fbrefProfiles};localStorage.setItem("pg_fbref_profiles",JSON.stringify(fbrefProfiles));saveSharedState("fbref-profiles",fbrefProfiles);updateFbrefStatus()});
loadSharedState("match-contexts").then(value=>{if(value&&typeof value==="object"&&Object.keys(value).length){matchContexts={...value,...matchContexts};localStorage.setItem("pg_match_contexts",JSON.stringify(matchContexts));if(localWorldCupData)renderPrematchPanel()}});
$("#savePrediction").onclick=()=>{
  if(!currentPrediction){$("#message").classList.remove("success");showMessage("Primero genera un pronóstico.");return}
  const duplicate=predictionHistory.some(x=>!x.actual&&x.home===currentPrediction.home&&x.away===currentPrediction.away&&x.matchDate===currentPrediction.matchDate);
  if(duplicate){$("#message").classList.remove("success");showMessage("Ya existe un pronóstico pendiente para este encuentro.");return}
  const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  predictionHistory.unshift({id,savedAt:new Date().toISOString(),home:currentPrediction.home,away:currentPrediction.away,matchDate:currentPrediction.matchDate,prediction:JSON.parse(JSON.stringify(currentPrediction)),actual:null});
  saveHistory();renderPredictionHistory();
  $("#message").classList.add("success");showMessage("Pronóstico guardado. Después del partido podrás registrar el resultado real en el historial.");
  $("#historySection").scrollIntoView({behavior:"smooth",block:"start"});
};
$("#historyList").addEventListener("submit",event=>{
  event.preventDefault();const form=event.target;if(!form.matches(".actual-form"))return;
  const record=predictionHistory.find(x=>x.id===form.dataset.id);if(!record)return;
  const readRequired=name=>{const value=Number(form.elements[name].value);return Number.isInteger(value)&&value>=0?value:null};
  const readOptional=name=>{const element=form.elements[name];if(!element)return null;const raw=element.value.trim();if(raw==="")return null;const value=Number(raw);return Number.isInteger(value)&&value>=0?value:NaN};
  const readPair=(homeName,awayName)=>{const home=readOptional(homeName),away=readOptional(awayName);if(Number.isNaN(home)||Number.isNaN(away))return{error:true};if(home===null&&away===null)return{home:null,away:null,total:null};if(home===null||away===null)return{error:true};return{home,away,total:home+away}};
  const homeGoals=readRequired("homeGoals"),awayGoals=readRequired("awayGoals");
  const cornersPair=readPair("homeCorners","awayCorners"),cardsPair=readPair("homeCards","awayCards"),shotsPair=readPair("homeShots","awayShots"),shotsOnTargetPair=readPair("homeShotsOnTarget","awayShotsOnTarget"),foulsPair=readPair("homeFouls","awayFouls");
  if(homeGoals===null||awayGoals===null||[cornersPair,cardsPair,shotsPair,shotsOnTargetPair,foulsPair].some(x=>x.error)){$("#message").classList.remove("success");showMessage("Revisa el resultado: cada estadística debe tener ambos equipos completos o quedar vacía.");return}
  const knockout=isKnockoutRecord(record),qualifiedSide=form.elements.qualifiedSide?.value||"",homePenalties=readOptional("homePenalties"),awayPenalties=readOptional("awayPenalties");
  if(knockout&&homeGoals===awayGoals&&!qualifiedSide){$("#message").classList.remove("success");showMessage("Este partido terminó empatado en eliminatoria. Indica quién clasificó por penales.");return}
  if(Number.isNaN(homePenalties)||Number.isNaN(awayPenalties)||(homePenalties===null&&awayPenalties!==null)||(homePenalties!==null&&awayPenalties===null)){$("#message").classList.remove("success");showMessage("Si registras penales, completa ambos equipos.");return}
  if(homePenalties!==null&&awayPenalties!==null&&homePenalties===awayPenalties){$("#message").classList.remove("success");showMessage("La tanda de penales no puede quedar empatada.");return}
  if(qualifiedSide&&homePenalties!==null&&awayPenalties!==null&&((homePenalties>awayPenalties)!==(qualifiedSide==="home"))){$("#message").classList.remove("success");showMessage("El clasificado no coincide con el ganador de penales.");return}
  record.actual={homeGoals,awayGoals,
    homeCorners:cornersPair.home,awayCorners:cornersPair.away,corners:cornersPair.total,
    homeCards:cardsPair.home,awayCards:cardsPair.away,cards:cardsPair.total,
    homeShots:shotsPair.home,awayShots:shotsPair.away,shots:shotsPair.total,
    homeShotsOnTarget:shotsOnTargetPair.home,awayShotsOnTarget:shotsOnTargetPair.away,shotsOnTarget:shotsOnTargetPair.total,
    homeFouls:foulsPair.home,awayFouls:foulsPair.away,fouls:foulsPair.total,
    homePenalties:homePenalties===null?null:homePenalties,awayPenalties:awayPenalties===null?null:awayPenalties,qualifiedSide:qualifiedSide||null,
    source:"Registro manual",recordedAt:new Date().toISOString()};
  saveHistory();renderPredictionHistory();refreshTournamentAfterResult();
  $("#message").classList.add("success");showMessage("Resultado evaluado. El panel de rendimiento ya fue actualizado.");
});
$("#historyList").addEventListener("click",event=>{
  const button=event.target.closest(".delete-prediction");if(!button)return;
  predictionHistory=predictionHistory.filter(x=>x.id!==button.dataset.id);saveHistory();renderPredictionHistory();
});
$("#historySection")?.addEventListener("click",event=>{const button=event.target.closest(".history-filter");if(!button)return;historyFilter=button.dataset.historyFilter||"all";renderPredictionHistory()});
$("#recalculateAll")?.addEventListener("click",recalculateEverything);
$("#exportDayReport")?.addEventListener("click",exportDayReport);
$("#globalPlayableOnly")?.addEventListener("change",event=>{playableOnlyMode=event.target.checked;localStorage.setItem("pg_playable_only",playableOnlyMode?"1":"0");renderSystemControlPanel();if(currentPrediction)showMessage(playableOnlyMode?"Filtro jugable activado. Regenera el pronóstico para ver solo picks filtrados.":"Filtro jugable desactivado.")});
$("#toggleDetails").onclick=()=>$("#details").classList.toggle("hidden");
$("#loadTeams").onclick=async()=>{
  try{
    localWorldCupData=null;
    $("#loadTeams").textContent="Cargando…";
    const international=$("#competition").value==="WC";
    const data=international?await api("/api/international/world-cup/teams"):await api(`/api/competitions/${$("#competition").value}/teams`);
    teams=international?(data.response||[]).map(x=>x.team):data.teams||[];
    fillTeamSelectors(teams);
    $("#sourceStatus").textContent=international?"Historial internacional conectado":"Datos reales conectados"; $("#message").classList.add("hidden");
  }catch(e){showMessage(e.message)}finally{$("#loadTeams").textContent="Cargar equipos"}
};

$("#analyze").onclick=async()=>{
  const btn=$("#analyze"); btn.disabled=true; btn.querySelector("span").textContent="Analizando últimos partidos…"; $("#message").classList.add("hidden");
  try{
    let home,away;
    if(manualMode){
      const hn=$("#manualHomeName").value.trim(),an=$("#manualAwayName").value.trim();
      if(!hn||!an)throw new Error("Escribe el nombre de ambas selecciones.");
      home=parseManual($("#manualHomeResults").value,hn);
      away=parseManual($("#manualAwayResults").value,an);
    }
    else if(localWorldCupData){
      const sameSelected=selectedFixture?.team1===$("#homeTeam").value&&selectedFixture?.team2===$("#awayTeam").value;
      const fixture=sameSelected?selectedFixture:localWorldCupData.matches.find(m=>m.team1===$("#homeTeam").value&&m.team2===$("#awayTeam").value);selectedFixture=fixtureContext(fixture);
      const cutoffDate=selectedFixture?.date||null,ratingsForMatch=cutoffDate?buildEloRatings(localWorldCupData.history,cutoffDate):teamRatings;
      home=normalizeLocalWorldCupTeam($("#homeTeam").value,cutoffDate,ratingsForMatch);
      away=normalizeLocalWorldCupTeam($("#awayTeam").value,cutoffDate,ratingsForMatch);
      if(home.name===away.name)throw new Error("Selecciona dos selecciones diferentes.");
      if(home.matches.length<10||away.matches.length<10)throw new Error(`Datos del Mundial cargados, pero aún faltan antecedentes: ${home.name} tiene ${home.matches.length} y ${away.name} tiene ${away.matches.length}. Necesitamos completar 10 por selección con los archivos históricos que encuentres.`);
    }
    else if(!teams.length){home=DEMO.home;away=DEMO.away}
    else{
      const ht=teams.find(t=>String(t.id)===$("#homeTeam").value), at=teams.find(t=>String(t.id)===$("#awayTeam").value);
      if(!ht||!at||ht.id===at.id)throw new Error("Selecciona dos equipos diferentes.");
      const international=$("#competition").value==="WC";
      const [hm,am]=international
        ?await Promise.all([api(`/api/international/teams/${ht.id}/matches`),api(`/api/international/teams/${at.id}/matches`)])
        :await Promise.all([api(`/api/teams/${ht.id}/matches`),api(`/api/teams/${at.id}/matches`)]);
      home=international?normalizeInternationalTeam(ht,hm):normalizeApiTeam(ht,hm);
      away=international?normalizeInternationalTeam(at,am):normalizeApiTeam(at,am);
      if(home.matches.length<5||away.matches.length<5)throw new Error("No hay suficientes partidos terminados para un pronóstico fiable.");
    }
    render(home,away,predict(home,away));
  }catch(e){showMessage(e.message)}finally{btn.disabled=false;btn.querySelector("span").textContent="Generar pronóstico"}
};

$("#homeTeam").onchange=e=>{$(".crest.home").textContent=initials(e.target.selectedOptions[0].text);if(localWorldCupData)renderPrematchPanel()};
$("#awayTeam").onchange=e=>{$(".crest.away").textContent=initials(e.target.selectedOptions[0].text);if(localWorldCupData)renderPrematchPanel()};
$("#prematchPanel").addEventListener("change",event=>{const context=activeMatchContext();if(event.target.matches("select[data-player-id]")){context.playerStatuses[event.target.dataset.playerId]=event.target.value;event.target.closest(".lineup-player")?.classList.toggle("out",event.target.value==="out"||event.target.value==="suspended")}else if(event.target.id==="matchReferee"){const official=officialCatalog.find(x=>x.id===event.target.value);context.refereeId=official?.id||null;context.refereeName=official?.name||null;context.refereeCards=null;context.refereeFouls=null;context.refereeSource=official?.source||null;updateRefereePanel()}else if(event.target.id==="refereeCards")context.refereeCards=event.target.value===""?null:Number(event.target.value);else if(event.target.id==="refereeFouls")context.refereeFouls=event.target.value===""?null:Number(event.target.value);context.updatedAt=new Date().toISOString();updateRefereePanel();saveMatchContexts()});
$("#prematchPanel").addEventListener("input",event=>{if(event.target.id!=="refereeCards"&&event.target.id!=="refereeFouls")return;const context=activeMatchContext(),field=event.target.id==="refereeCards"?"refereeCards":"refereeFouls";context[field]=event.target.value===""?null:Number(event.target.value);const parts=[];if(Number(context.refereeCards)>0)parts.push(`${Number(context.refereeCards).toFixed(1)} tarjetas`);if(Number(context.refereeFouls)>0)parts.push(`${Number(context.refereeFouls).toFixed(1)} faltas`);$("#refereeImpact").textContent=parts.length?`Ajuste activo: ${parts.join(" · ")}`:"Sin ajuste arbitral";$("#refereeImpact").classList.toggle("active",Boolean(parts.length));saveMatchContexts()});
$("#competition").onchange=e=>{
  localWorldCupData=null;
  const international=e.target.value==="WC";
  teams=[];
  $("#apiKey").value="";
  $("#apiKey").placeholder=international?"API-Football key":"football-data.org API key";
  $("#providerHint").innerHTML=international
    ?'<b>Modo selecciones:</b> requiere una clave de <a href="https://dashboard.api-football.com/register" target="_blank" rel="noreferrer">API-Football</a>. Busca los últimos 10 sin filtro de torneo: amistosos, eliminatorias, Copa América, Eurocopa, Nations League y Mundial.'
    :'<b>Modo clubes:</b> utiliza tu clave de football-data.org y toma los últimos partidos disponibles del equipo.';
};

[["#manualHomeResults","#homeCount"],["#manualAwayResults","#awayCount"]].forEach(([a,b])=>{
  $(a).addEventListener("input",()=>updateManualCount($(a),$(b)));
});
[["#homeCsv","#manualHomeResults","#homeCount"],["#awayCsv","#manualAwayResults","#awayCount"]].forEach(([file,area,count])=>{
  $(file).addEventListener("change",async e=>{
    const selected=e.target.files[0];if(!selected)return;
    $(area).value=await selected.text();updateManualCount($(area),$(count));
  });
});
