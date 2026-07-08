let paperBets=[],paperBankroll=1000,labWindow=20,activeLabMarkets=[],chronologicalLabCache={key:"",records:[]},labErrorMarket="winner",lastLabSample=[];
const PAPER_RISK={perBet:.02,perMatch:.05,total:.15};
try{paperBets=JSON.parse(localStorage.getItem("pg_paper_bets")||"[]");if(!Array.isArray(paperBets))paperBets=[]}catch(_){paperBets=[]}
let migratedPaperBets=false;paperBets.forEach(bet=>{if(!Number.isFinite(bet.openingOdds)&&Number.isFinite(bet.bookmakerOdds)){bet.openingOdds=bet.bookmakerOdds;migratedPaperBets=true}if(typeof repairLegacyText==="function"){const label=repairLegacyText(bet.marketLabel);if(label!==bet.marketLabel){bet.marketLabel=label;migratedPaperBets=true}}});if(migratedPaperBets)localStorage.setItem("pg_paper_bets",JSON.stringify(paperBets));
paperBankroll=Number(localStorage.getItem("pg_paper_bankroll")||1000);if(!Number.isFinite(paperBankroll)||paperBankroll<=0)paperBankroll=1000;
const labEscape=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const labPct=value=>Number.isFinite(value)?`${Math.round(value*100)}%`:"—";
const labUnits=value=>`${value>=0?"":"−"}${Math.abs(value).toFixed(2)} u.`;
const labId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;

function labMarketsFromPrediction(prediction){
  if(!prediction)return[];const p=prediction.probabilities||{},markets=[];
  const add=(id,label,probability,kind,extra={})=>{if(Number.isFinite(probability)&&probability>0&&probability<1)markets.push({id,label,probability,kind,...extra})};
  add("result_home",`${prediction.home} gana`,p.home,"result",{side:"home"});add("result_draw","Empate",p.draw,"result",{side:"draw"});add("result_away",`${prediction.away} gana`,p.away,"result",{side:"away"});
  add("double_home",`${prediction.home} o empate`,p.doubleChanceHome??p.home+p.draw,"double",{side:"home_or_draw"});add("double_away",`${prediction.away} o empate`,p.doubleChanceAway??p.away+p.draw,"double",{side:"away_or_draw"});
  [[1.5,p.over15],[2.5,p.over25],[3.5,p.over35]].forEach(([line,over])=>{add(`goals_over_${line}`,`Más de ${line} goles`,over,"total",{stat:"goals",side:"over",threshold:line});add(`goals_under_${line}`,`Menos de ${line} goles`,1-over,"total",{stat:"goals",side:"under",threshold:line})});
  add("btts_yes","Ambos marcan: sí",p.btts,"btts",{side:"yes"});add("btts_no","Ambos marcan: no",1-p.btts,"btts",{side:"no"});
  add("exact_score",`Marcador exacto ${prediction.score.home}–${prediction.score.away}`,prediction.score.probability,"exact",{homeGoals:prediction.score.home,awayGoals:prediction.score.away});
  Object.entries(prediction.footy?.cornersLines||{}).forEach(([key,over])=>{const line=Number(key.replace("_","."));add(`corners_over_${key}`,`Más de ${line} córners`,over,"total",{stat:"corners",side:"over",threshold:line});add(`corners_under_${key}`,`Menos de ${line} córners`,1-over,"total",{stat:"corners",side:"under",threshold:line})});
  Object.entries(prediction.footy?.cardsLines||{}).forEach(([key,over])=>{const line=Number(key.replace("_",".")),adjusted=.5+(over-.5)*.55;add(`cards_over_${key}`,`Más de ${line} tarjetas`,adjusted,"total",{stat:"cards",side:"over",threshold:line,experimental:true});add(`cards_under_${key}`,`Menos de ${line} tarjetas`,1-adjusted,"total",{stat:"cards",side:"under",threshold:line,experimental:true})});
  Object.values(prediction.statMarkets||{}).forEach(group=>(group.lines||[]).forEach(line=>add(line.id,line.label,line.probability,"total",{stat:line.stat,scope:line.scope,side:line.side,threshold:line.threshold,sample:line.sample,estimated:true})));
  const official=Object.values(prediction.officialPicks||{}).filter(pick=>pick&&!pick.abstain),matches=(market,pick)=>market.kind==="total"?market.stat===pick.stat&&market.side===pick.side&&market.threshold===pick.threshold&&(!pick.scope||market.scope===pick.scope):market.kind===pick.market&&(market.kind==="result"?market.side===pick.side:market.kind==="btts"?market.side===pick.side:market.kind==="exact"?market.homeGoals===pick.homeGoals&&market.awayGoals===pick.awayGoals:false);
  markets.forEach(m=>{m.official=official.some(pick=>matches(m,pick))});return markets.sort((a,b)=>Number(b.official)-Number(a.official)||b.probability-a.probability||a.label.localeCompare(b.label));
}

function snapshotOddsForMarket(market,prediction=currentPrediction){
  if(!market||market.kind!=="result"||!prediction?.marketOdds)return null;
  const value=Number(prediction.marketOdds[market.side]);return value>1?value:null;
}

function applySnapshotOdds(){
  const odds=snapshotOddsForMarket(selectedLabMarket());$("#bookmakerOdds").value=odds?odds.toFixed(2):"";
  if(odds)$("#labToast").textContent=`Cuota 1X2 importada · ${currentPrediction.marketOdds.source||"fuente guardada"}`;
}

function updateBetLabForPrediction(){
  activeLabMarkets=labMarketsFromPrediction(currentPrediction);const select=$("#labMarket");
  if(!select)return;select.innerHTML=activeLabMarkets.length?activeLabMarkets.map(m=>`<option value="${m.id}">${m.official?"★ Oficial · ":""}${m.experimental?"⚠ Experimental · ":""}${labEscape(m.label)} · ${labPct(m.probability)}</option>`).join(""):'<option value="">Genera primero un pronóstico</option>';
  $("#bookmakerOdds").value="";$("#labToast").textContent="";applySnapshotOdds();renderValueCalculator();
}

function selectedLabMarket(){return activeLabMarkets.find(m=>m.id===$("#labMarket").value)||null}
function simulatedKelly(market,odds){
  if(!market||!Number.isFinite(odds)||odds<=1)return{full:0,fraction:.0,stake:0};const b=odds-1,p=market.probability,q=1-p,full=Math.max(0,(b*p-q)/b),fraction=Math.min(.02,full*.25),stake=Math.min(availablePaperBalance(),paperBankroll*fraction);return{full,fraction,stake};
}
function renderValueCalculator(){
  const market=selectedLabMarket(),odds=Number($("#bookmakerOdds").value),stake=Number($("#paperStake").value),validOdds=Number.isFinite(odds)&&odds>1,edge=market&&validOdds?market.probability*odds-1:null;
  const tone=edge===null?"":edge>.05?"good":edge>=0?"watch":"bad",edgeText=edge===null?"—":`${edge>=0?"+":""}${Math.round(edge*100)}%`,kelly=simulatedKelly(market,odds),risk=paperRiskCheck(market,stake);
  $("#valueResults").innerHTML=`<div><span>PROBABILIDAD</span><b>${market?labPct(market.probability):"—"}</b></div><div><span>CUOTA JUSTA</span><b>${market?(1/market.probability).toFixed(2):"—"}</b></div><div><span>VENTAJA</span><b class="${tone}">${edgeText}</b></div>${market&&validOdds?`<div><span>PROB. DE LA CASA</span><b>${labPct(1/odds)}</b></div><div><span>VALOR ESPERADO</span><b class="${tone}">${labUnits(stake*edge)}</b></div><div><span>KELLY ¼ LIMITADO</span><b>${kelly.stake>0?`${labUnits(kelly.stake)} · ${labPct(kelly.fraction)}`:"0.00 u."}</b></div>`:""}`;
  $("#stakeGuard").innerHTML=[...risk.errors.map(x=>`<div class="guard-line danger">${labEscape(x)}</div>`),...risk.warnings.map(x=>`<div class="guard-line warning">${labEscape(x)}</div>`),...(!risk.errors.length&&!risk.warnings.length&&market?[`<div class="guard-line good">Límites: ${labUnits(risk.maxBet)} por apuesta · ${labUnits(risk.maxMatch)} por partido · ${labUnits(risk.maxTotal)} pendientes.</div>`]:[])].join("");
  $("#addPaperBet").disabled=!(currentPrediction&&market&&validOdds&&risk.allowed);
  $("#useKellyStake").disabled=!(kelly.stake>=1);$("#useKellyStake").dataset.stake=kelly.stake.toFixed(2);
}

function ensureLabPredictionSaved(){
  let record=predictionHistory.find(x=>x.home===currentPrediction.home&&x.away===currentPrediction.away&&x.matchDate===currentPrediction.matchDate);
  if(record)return record;
  record={id:labId(),savedAt:new Date().toISOString(),home:currentPrediction.home,away:currentPrediction.away,matchDate:currentPrediction.matchDate,prediction:JSON.parse(JSON.stringify(currentPrediction)),actual:null};predictionHistory.unshift(record);saveHistory();renderPredictionHistory();return record;
}
function savePaperState(){localStorage.setItem("pg_paper_bets",JSON.stringify(paperBets));localStorage.setItem("pg_paper_bankroll",String(paperBankroll));if(typeof saveSharedState==="function")saveSharedState("paper-bets",{bets:paperBets,bankroll:paperBankroll})}
function realizedPaperProfit(){return paperBets.filter(x=>x.status!=="pending").reduce((sum,x)=>sum+x.profit,0)}
function pendingPaperStake(){return paperBets.filter(x=>x.status==="pending").reduce((sum,x)=>sum+x.stake,0)}
function availablePaperBalance(){return paperBankroll+realizedPaperProfit()-pendingPaperStake()}
function paperMatchKey(value){return `${value.matchDate||"sin-fecha"}|${value.home}|${value.away}`}
function paperMarketGroup(market){if(market?.kind==="total")return market.stat||"total";return market?.kind||"otro"}
function cardResultCount(){return predictionHistory.filter(x=>Number.isFinite(x.actual?.cards)).length}
function marketsCorrelated(a,b){
  if(!a||!b)return false;const ga=paperMarketGroup(a),gb=paperMarketGroup(b);if(ga===gb)return true;
  const pairs=new Set([`${ga}|${gb}`,`${gb}|${ga}`]);
  if(pairs.has("goals|btts")||pairs.has("result|double")||pairs.has("result|exact")||pairs.has("double|exact"))return true;
  return false;
}
function paperRiskCheck(market,stake,prediction=currentPrediction){
  const pending=paperBets.filter(x=>x.status==="pending"),match=pending.filter(x=>prediction&&paperMatchKey(x)===paperMatchKey(prediction)),maxBet=paperBankroll*PAPER_RISK.perBet,maxMatch=paperBankroll*PAPER_RISK.perMatch,maxTotal=paperBankroll*PAPER_RISK.total,errors=[],warnings=[];
  if(!Number.isFinite(stake)||stake<=0)errors.push("Introduce una apuesta válida.");
  if(stake>maxBet+.001)errors.push(`Máximo por apuesta: ${labUnits(maxBet)} (2% de la banca).`);
  if(match.reduce((s,x)=>s+x.stake,0)+stake>maxMatch+.001)errors.push(`Máximo acumulado en este partido: ${labUnits(maxMatch)} (5%).`);
  if(pending.reduce((s,x)=>s+x.stake,0)+stake>maxTotal+.001)errors.push(`Máximo total pendiente: ${labUnits(maxTotal)} (15%).`);
  if(stake>availablePaperBalance()+.001)errors.push("El importe supera el saldo disponible.");
  const correlated=match.filter(x=>marketsCorrelated(x.market,market));if(correlated.length)warnings.push(`${correlated.length} apuesta${correlated.length===1?"":"s"} del partido puede${correlated.length===1?"":"n"} estar correlacionada${correlated.length===1?"":"s"}.`);
  if(market?.experimental){const count=cardResultCount();warnings.push(count<30?`Tarjetas es experimental (${count}/30 resultados) y su probabilidad está reducida hacia 50%.`:`Tarjetas ya tiene ${count} resultados, pero seguirá experimental hasta completar una recalibración.`)}
  return{allowed:errors.length===0,errors,warnings,maxBet,maxMatch,maxTotal};
}

function addPaperBet(){
  const market=selectedLabMarket(),odds=Number($("#bookmakerOdds").value),stake=Number($("#paperStake").value),risk=paperRiskCheck(market,stake);if(!currentPrediction||!market||odds<=1||!risk.allowed){$("#labToast").classList.add("error");$("#labToast").textContent=risk.errors[0]||"Revisa la cuota y el importe.";return}
  const record=ensureLabPredictionSaved(),kelly=simulatedKelly(market,odds);paperBets.unshift({id:labId(),predictionId:record.id,createdAt:new Date().toISOString(),matchDate:currentPrediction.matchDate,home:currentPrediction.home,away:currentPrediction.away,modelVersion:currentPrediction.modelVersion||"Anterior",marketId:market.id,marketLabel:market.label,market:{...market},modelProbability:market.probability,fairOdds:1/market.probability,openingOdds:odds,bookmakerOdds:odds,closingOdds:null,stake,kellyFraction:kelly.fraction,kellyStake:kelly.stake,status:"pending",profit:0});savePaperState();
  $("#labToast").classList.remove("error");$("#labToast").textContent="Apuesta ficticia guardada. Se liquidará al registrar el resultado en el historial.";renderPaperBets();renderValueCalculator();
}

function paperBetResult(bet,actual){
  const m=bet.market,totalGoals=actual.homeGoals+actual.awayGoals;if(m.kind==="result")return outcome(actual.homeGoals,actual.awayGoals)===m.side;
  if(m.kind==="double"){const result=outcome(actual.homeGoals,actual.awayGoals);return m.side==="home_or_draw"?result!=="away":result!=="home"}
  if(m.kind==="btts")return (actual.homeGoals>0&&actual.awayGoals>0)===(m.side==="yes");
  if(m.kind==="exact")return actual.homeGoals===m.homeGoals&&actual.awayGoals===m.awayGoals;
  if(m.kind==="total"){const value=typeof actualStatValue==="function"?actualStatValue(actual,m.stat,m.scope||"total"):{goals:totalGoals,corners:actual.corners,cards:actual.cards,shots:actual.shots,shots_on_target:actual.shotsOnTarget,fouls:actual.fouls}[m.stat];if(!Number.isFinite(value))return null;return m.side==="over"?value>m.threshold:value<m.threshold}
  return null;
}
function settlePaperBets(){
  let changed=false;paperBets.filter(x=>x.status==="pending").forEach(bet=>{const record=predictionHistory.find(x=>x.id===bet.predictionId)||(predictionHistory.find(x=>x.home===bet.home&&x.away===bet.away&&x.matchDate===bet.matchDate));if(!record?.actual)return;const won=paperBetResult(bet,record.actual);if(won===null)return;const opening=Number(bet.openingOdds||bet.bookmakerOdds);bet.status=won?"won":"lost";bet.profit=won?bet.stake*(opening-1):-bet.stake;bet.settledAt=new Date().toISOString();changed=true});if(changed)savePaperState();return changed
}

function renderPaperAlerts(){
  const panel=$("#paperAlerts"),pending=paperBets.filter(x=>x.status==="pending");if(!panel)return;if(!pending.length){panel.innerHTML='<div class="paper-alert good">Sin exposición pendiente. El saldo está completamente disponible.</div>';return}
  const groups=new Map();pending.forEach(bet=>{const key=paperMatchKey(bet),group=groups.get(key)||{label:`${bet.home} vs ${bet.away}`,stake:0,bets:[]};group.stake+=bet.stake;group.bets.push(bet);groups.set(key,group)});const alerts=[],total=pending.reduce((sum,x)=>sum+x.stake,0),totalRate=total/paperBankroll;
  alerts.push(`<div class="paper-alert ${totalRate>=PAPER_RISK.total?"danger":""}">Exposición total pendiente: ${labPct(totalRate)} de la banca. Límite ${labPct(PAPER_RISK.total)}.</div>`);
  [...groups.values()].sort((a,b)=>b.stake-a.stake).forEach(group=>{const rate=group.stake/paperBankroll,correlated=group.bets.some((a,i)=>group.bets.slice(i+1).some(b=>marketsCorrelated(a.market,b.market)));if(rate>=PAPER_RISK.perMatch||correlated)alerts.push(`<div class="paper-alert ${rate>=PAPER_RISK.perMatch?"danger":""}"><b>${labEscape(group.label)}</b>: ${labUnits(group.stake)} (${labPct(rate)}). ${correlated?"Hay mercados correlacionados.":""}</div>`)});panel.innerHTML=alerts.join("");
}

function paperBetVersion(bet){if(bet.modelVersion)return bet.modelVersion;const record=predictionHistory.find(x=>x.id===bet.predictionId);return record?.prediction?.modelVersion||"Anterior"}
function paperPerformanceRows(settled,keyFn){
  const groups=new Map();settled.forEach(bet=>{const key=keyFn(bet),list=groups.get(key)||[];list.push(bet);groups.set(key,list)});
  return[...groups.entries()].map(([label,list])=>{const stake=list.reduce((s,x)=>s+x.stake,0),profit=list.reduce((s,x)=>s+x.profit,0);return{label,n:list.length,wins:list.filter(x=>x.status==="won").length,profit,roi:stake?profit/stake:null}}).sort((a,b)=>b.n-a.n||b.roi-a.roi);
}
function robustPerformance(list){
  const ordered=[...list].sort((a,b)=>(a.settledAt||a.createdAt||"").localeCompare(b.settledAt||b.createdAt||"")),stake=ordered.reduce((s,x)=>s+x.stake,0),profit=ordered.reduce((s,x)=>s+x.profit,0),wins=ordered.filter(x=>x.status==="won").length,n=ordered.length,roi=stake?profit/stake:0,accuracy=n?wins/n:0,brier=n?ordered.reduce((s,x)=>s+Math.pow((x.status==="won"?1:0)-clamp(Number(x.modelProbability)||.5,.01,.99),2),0)/n:null,clvValues=ordered.map(x=>{const opening=Number(x.openingOdds||x.bookmakerOdds),closing=Number(x.closingOdds);return opening>1&&closing>1?opening/closing-1:null}).filter(Number.isFinite),avgClv=clvValues.length?clvValues.reduce((s,x)=>s+x,0)/clvValues.length:null;
  let cumulative=0,peak=0,maxDrawdown=0;ordered.forEach(x=>{cumulative+=x.profit;peak=Math.max(peak,cumulative);maxDrawdown=Math.max(maxDrawdown,peak-cumulative)});
  const z=1.96,denominator=1+z*z/Math.max(n,1),center=(accuracy+z*z/(2*Math.max(n,1)))/denominator,margin=n?(z*Math.sqrt(accuracy*(1-accuracy)/n+z*z/(4*n*n)))/denominator:0,lower=Math.max(0,center-margin),upper=Math.min(1,center+margin),shrunkRoi=roi*n/(n+20),rankScore=shrunkRoi-(brier??.25)*.04;
  return{n,wins,stake,profit,roi,accuracy,brier,maxDrawdown,lower,upper,rankScore,avgClv,clvN:clvValues.length,status:n>=50?"robusto":n>=20?"provisional":"insuficiente"};
}
function renderMarketRanking(settled){
  const panel=$("#marketRankingPanel");if(!panel)return;const labels={result:"Resultado",double:"Doble oportunidad",goals:"Goles",btts:"Ambos marcan",exact:"Marcador exacto",corners:"Córners",cards:"Tarjetas"},groups=new Map();settled.forEach(bet=>{const key=labels[paperMarketGroup(bet.market)]||paperMarketGroup(bet.market),list=groups.get(key)||[];list.push(bet);groups.set(key,list)});
  const rows=[...groups.entries()].map(([label,list])=>({label,...robustPerformance(list)})).sort((a,b)=>(b.status!=="insuficiente")-(a.status!=="insuficiente")||b.rankScore-a.rankScore||b.n-a.n);
  panel.innerHTML=`<div class="calibration-head"><div><small>RENTABILIDAD CONTROLADA</small><h3>Ranking de mercados</h3></div><span class="ranking-rule">Mínimo 20 para comparar</span></div>${rows.length?`<div class="market-scorecard">${rows.map((r,i)=>`<div class="market-score-row ${r.status}"><i>${i+1}</i><span><b>${labEscape(r.label)}</b><small>${r.wins}/${r.n} · acierto ${labPct(r.accuracy)} · Brier ${r.brier.toFixed(3)} · caída máx. ${labUnits(r.maxDrawdown)} · CLV ${r.avgClv===null?"—":labPct(r.avgClv)} (${r.clvN})</small></span><strong class="${r.roi>=0?"positive":"negative"}">${labPct(r.roi)}</strong><em>${r.status==="insuficiente"?"MUESTRA CORTA":r.status.toUpperCase()}</em></div>`).join("")}</div>`:'<div class="insight-empty">Aún no hay apuestas liquidadas. El ranking aparecerá cuando registres resultados.</div>'}<p class="sample-warning">El orden penaliza muestras pequeñas y mala calibración. El ROI bruto nunca se considera suficiente por sí solo.</p>`;
}
function renderTeamHeatmap(settled){
  const panel=$("#teamHeatmapPanel");if(!panel)return;const groups=new Map();settled.forEach(bet=>[bet.home,bet.away].filter(Boolean).forEach(team=>{const list=groups.get(team)||[];list.push(bet);groups.set(team,list)}));const rows=[...groups.entries()].map(([team,list])=>({team,...robustPerformance(list)})).sort((a,b)=>b.n-a.n||b.rankScore-a.rankScore).slice(0,16);
  panel.innerHTML=`<div class="calibration-head"><div><small>MAPA DE SELECCIONES</small><h3>Rendimiento por equipo</h3></div><span class="ranking-rule">Mínimo 10 apuestas</span></div>${rows.length?`<div class="team-heatmap">${rows.map(r=>{const reliable=r.n>=10,tone=!reliable?"neutral":r.roi>=.05?"hot":r.roi<=-.05?"cold":"even";return`<div class="heat-team ${tone}"><span>${labEscape(r.team)}<small>${r.n} apuestas · ${r.wins} ganadas</small></span><b>${reliable?labPct(r.roi):"—"}</b><em>${reliable?`IC acierto ${labPct(r.lower)}–${labPct(r.upper)}`:"DATOS INSUFICIENTES"}</em></div>`}).join("")}</div>`:'<div class="insight-empty">El mapa se construirá con las apuestas ficticias liquidadas.</div>'}<p class="sample-warning">Una apuesta del partido cuenta para las dos selecciones. Los colores se activan únicamente desde 10 registros.</p>`;
}
function renderPaperPerformance(settled){
  const panel=$("#paperPerformance");if(!panel)return;renderMarketRanking(settled);renderTeamHeatmap(settled);if(!settled.length){panel.innerHTML='<div class="paper-empty">Sin apuestas liquidadas para comparar ROI por versión.</div>';return}
  const labels={result:"Resultado",double:"Doble oportunidad",goals:"Goles",btts:"Ambos marcan",exact:"Marcador exacto",corners:"Córners",cards:"Tarjetas"},markets=paperPerformanceRows(settled,bet=>labels[paperMarketGroup(bet.market)]||paperMarketGroup(bet.market)),versions=paperPerformanceRows(settled,bet=>`Modelo ${paperBetVersion(bet)}`),rows=(items)=>items.map(x=>`<div class="performance-row"><span>${labEscape(x.label)}<small>${x.wins}/${x.n} acertadas · ${labUnits(x.profit)}</small></span><b class="${x.roi>=0?"positive":"negative"}">${labPct(x.roi)}</b></div>`).join("");
  panel.innerHTML=`<div class="performance-block"><h4>ROI POR MERCADO</h4>${rows(markets)}</div><div class="performance-block"><h4>ROI POR VERSIÓN</h4>${rows(versions)}</div>`;
}

function labMetric(label,data){return `<div class="lab-metric"><span>${label}</span><b>${data.rate===null?"—":labPct(data.rate)}</b><small>${data.total?`${data.hits} de ${data.total}`:"Sin muestra"}</small></div>`}
function labOutcome(home,away){return home>away?"home":home<away?"away":"draw"}
function labPredictedOutcome(probabilities){return ["home","draw","away"].sort((a,b)=>probabilities[b]-probabilities[a])[0]}
function chronologicalBacktest(){
  if(!localWorldCupData?.matches||!localWorldCupData?.history)return[];
  const finished=localWorldCupData.matches.filter(m=>Array.isArray(m.score?.ft)&&teams.some(t=>t.name===m.team1)&&teams.some(t=>t.name===m.team2)).sort((a,b)=>a.date.localeCompare(b.date)||Number(a.num||0)-Number(b.num||0));
  const key=`2.6-shadow0.1|${finished.map(m=>`${m.date}:${m.team1}:${m.team2}:${m.score.ft.join("-")}`).join("|")}`;if(chronologicalLabCache.key===key)return chronologicalLabCache.records;
  const oldFixture=selectedFixture,oldRatings=teamRatings,records=[];
  try{
    finished.forEach(match=>{
      const ratings=buildEloRatings(localWorldCupData.history,match.date);teamRatings=ratings;selectedFixture=fixtureContext(match);
      const home=normalizeLocalWorldCupTeam(match.team1,match.date,ratings),away=normalizeLocalWorldCupTeam(match.team2,match.date,ratings);if(home.matches.length<5||away.matches.length<5)return;
      const result=predict(home,away),probabilities={home:result.hp,draw:result.dp,away:result.ap},shadow=buildShadowEnsemble(home,away,result),shadowProbabilities=shadow.probabilities,actualResult=labOutcome(match.score.ft[0],match.score.ft[1]),predictedResult=labPredictedOutcome(probabilities),shadowPredictedResult=labPredictedOutcome(shadowProbabilities),total=match.score.ft[0]+match.score.ft[1],actualProbability=Math.max(probabilities[actualResult],1e-9),shadowActualProbability=Math.max(shadowProbabilities[actualResult],1e-9);
      records.push({date:match.date,competition:"World Cup 2026",round:match.round||"Sin fase",group:match.group||null,phase:/matchday/i.test(match.round||"")?"Fase de grupos":match.round||"Eliminatoria",venueType:selectedFixture.neutral?"Sede neutral":"Anfitrión",home:match.team1,away:match.team2,actualScore:{home:match.score.ft[0],away:match.score.ft[1]},predictedScore:{home:result.best.h,away:result.best.a},expectedGoals:{home:result.xh,away:result.xa},actualResult,predictedResult,shadowPredictedResult,winner:actualResult===predictedResult,shadowWinner:actualResult===shadowPredictedResult,exact:match.score.ft[0]===result.best.h&&match.score.ft[1]===result.best.a,over:(total>2)===(result.over>=.5),btts:(match.score.ft[0]>0&&match.score.ft[1]>0)===(result.btts>=.5),actualOver:total>2,predictedOver:result.over>=.5,actualBtts:match.score.ft[0]>0&&match.score.ft[1]>0,predictedBtts:result.btts>=.5,probabilities,shadowProbabilities,brier:["home","draw","away"].reduce((sum,k)=>sum+Math.pow(probabilities[k]-(k===actualResult?1:0),2),0),shadowBrier:["home","draw","away"].reduce((sum,k)=>sum+Math.pow(shadowProbabilities[k]-(k===actualResult?1:0),2),0),logLoss:-Math.log(actualProbability),shadowLogLoss:-Math.log(shadowActualProbability),confidenceScore:result.confidenceScore,confidence:result.confidence,cutoff:match.date});
    });
  }finally{selectedFixture=oldFixture;teamRatings=oldRatings}
  chronologicalLabCache={key,records};return records;
}
function chronologicalRate(records,key){const values=records.map(x=>x[key]);return{hits:values.filter(Boolean).length,total:values.length,rate:values.length?values.filter(Boolean).length/values.length:null}}
function savedAudit(){const completed=predictionHistory.filter(x=>x.actual&&x.matchDate),forward=[],retrospective=[],sameDay=[];completed.forEach(x=>{const day=(x.savedAt||"").slice(0,10);if(day<x.matchDate)forward.push(x);else if(day>x.matchDate)retrospective.push(x);else sameDay.push(x)});return{completed,forward,retrospective,sameDay}}
function renderForwardSample(audit){
  const panel=$("#forwardSamplePanel");if(!panel)return;const pending=predictionHistory.filter(x=>!x.actual&&x.matchDate&&(x.savedAt||"").slice(0,10)<x.matchDate),valid=audit.forward.length,target=30,progress=Math.min(100,valid/target*100),state=valid>=target?"ready":valid>=10?"building":"early";
  panel.innerHTML=`<div class="forward-sample-main"><div><small>MUESTRA PREDICTIVA VÁLIDA</small><b>${valid}<i> / ${target}</i></b><span>${state==="ready"?"Mínimo inicial alcanzado":state==="building"?"Muestra en construcción":"Evidencia todavía temprana"}</span></div><div class="forward-progress"><i style="width:${progress}%"></i></div></div><div class="forward-sample-breakdown"><div><span>PREVIOS EVALUADOS</span><b>${valid}</b></div><div><span>PREVIOS PENDIENTES</span><b>${pending.length}</b></div><div><span>MISMO DÍA</span><b>${audit.sameDay.length}</b></div><div><span>RETROSPECTIVOS EXCLUIDOS</span><b>${audit.retrospective.length}</b></div></div><p>Solo “previos evaluados” cuentan como evidencia real del sistema. Los del mismo día se mantienen separados porque podrían haberse guardado después del inicio.</p>`;
}
function confusionMatrix(records){const labels=["home","draw","away"],matrix=Object.fromEntries(labels.map(a=>[a,Object.fromEntries(labels.map(p=>[p,0]))]));records.forEach(x=>matrix[x.actualResult][x.predictedResult]++);return matrix}
function binaryConfusion(records,actualKey,predictedKey){const out={tp:0,tn:0,fp:0,fn:0};records.forEach(x=>{const a=Boolean(x[actualKey]),p=Boolean(x[predictedKey]);out[a?(p?"tp":"fn"):(p?"fp":"tn")]++});return out}
function renderLabDiagnostics(chronological,saved){
  const panel=$("#labDiagnostics");if(!panel)return;if(!chronological.length){panel.innerHTML="";return}const matrix=confusionMatrix(chronological),draws=chronological.filter(x=>x.actualResult==="draw"),predictedDraws=chronological.filter(x=>x.predictedResult==="draw").length;
  const registered=saved.completed.map(record=>{const p=record.prediction,a=record.actual;return{actualCorners:Number.isFinite(a.corners)?a.corners>8.5:false,predictedCorners:Number.isFinite(a.corners)&&p.footy?p.footy.cornersOver85>=.5:false,hasCorners:Number.isFinite(a.corners)&&Boolean(p.footy),actualCards:Number.isFinite(a.cards)?a.cards>2.5:false,predictedCards:Number.isFinite(a.cards)&&p.footy?p.footy.cardsOver25>=.5:false,hasCards:Number.isFinite(a.cards)&&Boolean(p.footy)}});
  const rows=[["Goles +2.5",binaryConfusion(chronological,"actualOver","predictedOver")],["Ambos marcan",binaryConfusion(chronological,"actualBtts","predictedBtts")],["Córners +8.5",binaryConfusion(registered.filter(x=>x.hasCorners),"actualCorners","predictedCorners")],["Tarjetas +2.5",binaryConfusion(registered.filter(x=>x.hasCards),"actualCards","predictedCards")]];
  const officialBrier=chronological.reduce((s,x)=>s+x.brier,0)/chronological.length,shadowBrier=chronological.reduce((s,x)=>s+x.shadowBrier,0)/chronological.length,officialLog=chronological.reduce((s,x)=>s+x.logLoss,0)/chronological.length,shadowLog=chronological.reduce((s,x)=>s+x.shadowLogLoss,0)/chronological.length,shadowBetter=shadowBrier<officialBrier&&shadowLog<officialLog;
  panel.innerHTML=`<article class="card diagnostic-card"><h3>Matriz 1X2 cronológica</h3><table class="confusion-table"><thead><tr><th>Real ↓ / Modelo →</th><th>Local</th><th>Empate</th><th>Visita</th></tr></thead><tbody>${[["home","Local"],["draw","Empate"],["away","Visita"]].map(([key,label])=>`<tr><th>${label}</th>${["home","draw","away"].map(pred=>`<td class="${pred===key?"hit-cell":""}">${matrix[key][pred]}</td>`).join("")}</tr>`).join("")}</tbody></table><p>Empates reales: <b>${draws.length}</b> · empates elegidos por el modelo: <b>${predictedDraws}</b>. El refuerzo de empate se aplica solo cuando las fuerzas están próximas.</p></article><article class="card diagnostic-card"><h3>Errores por mercado</h3><div class="diagnostic-list"><div class="diagnostic-row"><b>Mercado</b><span>VP</span><span>VN</span><span>FP</span><span>FN</span></div>${rows.map(([label,c])=>`<div class="diagnostic-row"><b>${label}</b><span>${c.tp}</span><span>${c.tn}</span><span>${c.fp}</span><span>${c.fn}</span></div>`).join("")}</div><p>VP/VN son aciertos; FP/FN muestran en qué dirección se equivoca. Córners y tarjetas usan registros manuales y se muestran aparte del backtest cronológico.</p></article><article class="card diagnostic-card shadow-diagnostic"><h3>Campeón vs ensemble sombra</h3><div class="model-duel"><div><span>MODELO 2.6</span><b>${officialBrier.toFixed(3)}</b><small>Brier · Log Loss ${officialLog.toFixed(3)}</small></div><div><span>ENSEMBLE 0.1</span><b>${shadowBrier.toFixed(3)}</b><small>Brier · Log Loss ${shadowLog.toFixed(3)}</small></div></div><p class="${shadowBetter?"duel-good":"duel-watch"}">${shadowBetter?"El ensemble mejora ambas métricas en esta ventana, pero continúa en sombra hasta ampliar la muestra.":"El ensemble aún no supera al modelo oficial en ambas métricas; no será promovido."}</p></article>`;
}
function renderCalibration(records){
  const panel=$("#calibrationPanel");if(!panel)return;if(!records.length){panel.innerHTML="";return}const entries=records.flatMap(r=>["home","draw","away"].map(key=>({p:r.probabilities[key],actual:key===r.actualResult?1:0}))),bins=[0,.2,.4,.6,.8].map(start=>{const values=entries.filter(x=>x.p>=start&&x.p<(start+.2===1?1.0001:start+.2)),n=values.length,p=values.length?values.reduce((s,x)=>s+x.p,0)/values.length:0,actual=values.length?values.reduce((s,x)=>s+x.actual,0)/values.length:0;return{start,n,p,actual}}),ece=bins.reduce((sum,b)=>sum+(b.n/entries.length)*Math.abs(b.p-b.actual),0),brier=records.reduce((s,x)=>s+x.brier,0)/records.length,logLoss=records.reduce((s,x)=>s+x.logLoss,0)/records.length;
  panel.innerHTML=`<div class="calibration-head"><div><small>CALIBRACIÓN 1X2</small><h3>Curva de confiabilidad</h3></div><div class="calibration-scores"><div><span>BRIER</span><b>${brier.toFixed(3)}</b></div><div><span>LOG LOSS</span><b>${logLoss.toFixed(3)}</b></div><div><span>ERROR ECE</span><b>${labPct(ece)}</b></div></div></div><div class="reliability-chart">${bins.map(b=>`<div class="reliability-row"><span>${Math.round(b.start*100)}–${Math.round((b.start+.2)*100)}%</span><div class="reliability-bars"><div class="reliability-track"><i style="width:${labPct(b.p)}"></i></div><div class="reliability-track actual"><i style="width:${labPct(b.actual)}"></i></div></div><small>${labPct(b.p)} → ${labPct(b.actual)} · n=${b.n}</small></div>`).join("")}</div><p class="sample-warning">Azul: probabilidad media · Verde: frecuencia real. Con ${records.length} partidos todavía es una calibración provisional.</p>`;
}
function renderPerformanceBreakdown(records){
  const panel=$("#performanceBreakdown");if(!panel)return;if(!records.length){panel.innerHTML="";return}const groups=new Map(),add=(label,record)=>{const list=groups.get(label)||[];list.push(record);groups.set(label,list)};records.forEach(r=>{add(r.competition,r);add(`Confianza ${r.confidence.replace("Confianza ","").toLowerCase()}`,r);add(r.phase,r);add(r.venueType,r)});
  const rows=[...groups.entries()].filter(([,list])=>list.length>=2).map(([label,list])=>({label,n:list.length,winner:chronologicalRate(list,"winner").rate,exact:chronologicalRate(list,"exact").rate})).sort((a,b)=>b.n-a.n||b.winner-a.winner);
  panel.innerHTML=`<div class="calibration-head"><div><small>SEGMENTACIÓN</small><h3>Rendimiento por contexto</h3></div></div><div class="breakdown-list">${rows.map(r=>`<div class="breakdown-row"><span>${labEscape(r.label)}<small>${r.n} partidos · exacto ${labPct(r.exact)}</small></span><b>${labPct(r.winner)}</b></div>`).join("")}</div><p class="sample-warning">Los segmentos con menos de 2 partidos se ocultan para evitar conclusiones engañosas.</p>`;
}
function errorCause(record,market){
  if(market==="winner"){if(record.actualResult==="draw"&&record.predictedResult!=="draw")return"Subestimó la probabilidad de empate";if(record.predictedResult==="draw")return"Sobreestimó el equilibrio entre selecciones";return`Sobreestimó a ${record.predictedResult==="home"?record.home:record.away}`}
  if(market==="exact"){if(record.winner)return"Dirección correcta, pero falló la magnitud de goles";if(record.actualScore.home+record.actualScore.away===0)return"Sobreestimó la producción ofensiva";return"Variación de definición respecto a los goles esperados"}
  if(market==="over")return record.predictedOver?"Sobreestimó el ritmo y la producción de goles":"Subestimó el ritmo ofensivo del partido";
  return record.predictedBtts?"Esperaba gol de ambos, pero una selección quedó en cero":"Subestimó la capacidad de respuesta del rival";
}
function renderErrorDashboard(records=lastLabSample){
  lastLabSample=records;const panel=$("#errorDashboard");if(!panel)return;const failures=records.filter(r=>!r[labErrorMarket]),causes=new Map();failures.forEach(r=>{const cause=errorCause(r,labErrorMarket);causes.set(cause,(causes.get(cause)||0)+1)});if(!failures.length){panel.innerHTML='<div class="paper-alert good">No hay fallos en este mercado dentro de la muestra seleccionada.</div>';return}
  panel.innerHTML=`<div class="error-summary">${[...causes.entries()].sort((a,b)=>b[1]-a[1]).map(([cause,n])=>`<span class="error-cause">${n}× ${labEscape(cause)}</span>`).join("")}</div><div class="error-list">${failures.slice(0,12).map(r=>`<div class="error-match"><div><small>${r.date} · ${labEscape(r.phase)}</small><b>${labEscape(r.home)} vs ${labEscape(r.away)}</b></div><div class="error-score">${r.predictedScore.home}–${r.predictedScore.away} → ${r.actualScore.home}–${r.actualScore.away}</div><div class="error-reason">${labEscape(errorCause(r,labErrorMarket))}<small>xG ${r.expectedGoals.home.toFixed(2)}–${r.expectedGoals.away.toFixed(2)} · confianza ${r.confidenceScore}/100</small></div></div>`).join("")}</div>`;
}
function renderLabBacktest(){
  const all=chronologicalBacktest().slice().sort((a,b)=>b.date.localeCompare(a.date)),sample=labWindow==="all"?all:all.slice(0,labWindow),panel=$("#labBacktest"),audit=savedAudit();if(!panel)return;
  renderForwardSample(audit);if(!sample.length){panel.innerHTML='<div class="lab-empty">Carga “Mundial incluido” para ejecutar el backtesting cronológico sin información futura.</div>';$("#labAudit").innerHTML="";$("#labDiagnostics").innerHTML="";$("#calibrationPanel").innerHTML="";$("#performanceBreakdown").innerHTML="";$("#errorDashboard").innerHTML="";return}
  const baseline=sample.filter(x=>x.actualResult==="home").length/sample.length,brier=sample.reduce((sum,x)=>sum+x.brier,0)/sample.length;
  panel.innerHTML=`<div class="lab-metric"><span>PRUEBAS CRONOLÓGICAS</span><b>${sample.length}</b><small>corte antes del partido</small></div>${labMetric("GANADOR",chronologicalRate(sample,"winner"))}${labMetric("ENSEMBLE SOMBRA",chronologicalRate(sample,"shadowWinner"))}${labMetric("MARCADOR EXACTO",chronologicalRate(sample,"exact"))}${labMetric("OVER / UNDER 2.5",chronologicalRate(sample,"over"))}${labMetric("AMBOS MARCAN",chronologicalRate(sample,"btts"))}<div class="lab-metric"><span>BASE: SIEMPRE LOCAL</span><b>${labPct(baseline)}</b><small>comparación mínima</small></div><div class="lab-metric"><span>BRIER 1X2</span><b>${brier.toFixed(3)}</b><small>menor es mejor</small></div>`;
  $("#labAudit").className=`lab-audit${audit.retrospective.length?" warning":""}`;$("#labAudit").innerHTML=audit.retrospective.length?`<strong>Auditoría:</strong> ${audit.retrospective.length} registros fueron guardados después de la fecha del partido y se consideran retrospectivos. No se usan para medir capacidad predictiva. ${audit.forward.length} están confirmados como previos y ${audit.sameDay.length} son del mismo día.`:`<strong>Auditoría limpia:</strong> no hay registros posteriores al partido. ${audit.forward.length} pronósticos están confirmados como previos.`;
  renderLabDiagnostics(sample,audit);
  renderCalibration(sample);renderPerformanceBreakdown(sample);renderErrorDashboard(sample);
}
function refreshChronologicalLab(){chronologicalLabCache={key:"",records:[]};renderLabBacktest()}
function renderPaperBets(){
  settlePaperBets();const settled=paperBets.filter(x=>x.status!=="pending"),profit=realizedPaperProfit(),settledStake=settled.reduce((sum,x)=>sum+x.stake,0),roi=settledStake?profit/settledStake:null,balance=availablePaperBalance();
  $("#paperSummary").innerHTML=`<div class="paper-stat"><span>SALDO DISPONIBLE</span><b class="${balance>=paperBankroll?"positive":"negative"}">${labUnits(balance)}</b></div><div class="paper-stat"><span>BENEFICIO</span><b class="${profit>=0?"positive":"negative"}">${labUnits(profit)}</b></div><div class="paper-stat"><span>ROI</span><b>${roi===null?"—":labPct(roi)}</b></div><div class="paper-stat"><span>ACERTADAS</span><b>${settled.filter(x=>x.status==="won").length}/${settled.length}</b></div><div class="paper-stat"><span>PENDIENTES</span><b>${paperBets.filter(x=>x.status==="pending").length}</b></div>`;
  renderPaperAlerts();renderPaperPerformance(settled);
  if(!paperBets.length){$("#paperBetList").innerHTML='<div class="paper-empty">Aún no hay apuestas ficticias. Genera un pronóstico, escribe una cuota y prueba sin dinero real.</div>';return}
  $("#paperBetList").innerHTML=paperBets.map(bet=>{const opening=Number(bet.openingOdds||bet.bookmakerOdds),closing=Number(bet.closingOdds),clv=opening>1&&closing>1?opening/closing-1:null;return`<div class="paper-bet"><div><small>${labEscape(bet.home)} VS ${labEscape(bet.away)}</small><strong>${labEscape(bet.marketLabel)}</strong></div><div class="paper-cell"><span>MODELO / JUSTA</span><b>${labPct(bet.modelProbability)} · ${bet.fairOdds.toFixed(2)}</b></div><div class="paper-cell"><span>INICIAL / APUESTA</span><b>${opening.toFixed(2)} · ${labUnits(bet.stake)}</b></div><label class="closing-cell"><span>CUOTA DE CIERRE</span><input class="closing-odds" data-id="${bet.id}" type="number" min="1.01" step="0.01" placeholder="Ej. 1.70" value="${closing>1?closing.toFixed(2):""}"><small class="${clv===null?"":clv>=0?"positive":"negative"}">CLV ${clv===null?"pendiente":labPct(clv)}</small></label><div><span class="paper-status ${bet.status}">${bet.status==="won"?`GANÓ +${labUnits(bet.profit)}`:bet.status==="lost"?`PERDIÓ ${labUnits(bet.profit)}`:"PENDIENTE"}</span></div><button class="delete-paper" data-id="${bet.id}">Eliminar</button></div>`}).join("");
}
function renderBetLab(){renderLabBacktest();renderPaperBets();updateBetLabForPrediction();$("#paperBankroll").value=paperBankroll}
function onPredictionHistoryChanged(){settlePaperBets();renderLabBacktest();renderPaperBets()}

$("#labMarket").addEventListener("change",()=>{applySnapshotOdds();renderValueCalculator()});$("#bookmakerOdds").addEventListener("input",renderValueCalculator);$("#paperStake").addEventListener("input",renderValueCalculator);$("#addPaperBet").addEventListener("click",addPaperBet);$("#useKellyStake").addEventListener("click",()=>{const stake=Number($("#useKellyStake").dataset.stake);if(stake>0){$("#paperStake").value=stake.toFixed(2);renderValueCalculator()}});$("#errorMarket").addEventListener("change",event=>{labErrorMarket=event.target.value;renderErrorDashboard()});
$(".lab-window-buttons").addEventListener("click",event=>{const button=event.target.closest("button[data-window]");if(!button)return;labWindow=button.dataset.window==="all"?"all":Number(button.dataset.window);$(".lab-window-buttons").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===button));renderLabBacktest()});
$("#paperBankroll").addEventListener("change",event=>{const value=Number(event.target.value);if(Number.isFinite(value)&&value>0){paperBankroll=value;savePaperState();renderPaperBets();renderValueCalculator()}else event.target.value=paperBankroll});
$("#paperBetList").addEventListener("click",event=>{const button=event.target.closest(".delete-paper");if(!button)return;paperBets=paperBets.filter(x=>x.id!==button.dataset.id);savePaperState();renderPaperBets();renderValueCalculator()});
$("#paperBetList").addEventListener("change",event=>{const input=event.target.closest(".closing-odds");if(!input)return;const bet=paperBets.find(x=>x.id===input.dataset.id);if(!bet)return;const raw=input.value.trim(),value=raw===""?null:Number(raw);if(value!==null&&(!Number.isFinite(value)||value<=1)){input.value=Number(bet.closingOdds)>1?Number(bet.closingOdds).toFixed(2):"";return}bet.closingOdds=value;bet.closingOddsRecordedAt=value?new Date().toISOString():null;savePaperState();renderPaperBets()});
renderBetLab();
if(typeof loadSharedState==="function")loadSharedState("paper-bets").then(value=>{if(value&&Array.isArray(value.bets)){const hadLocal=paperBets.length>0,merged=new Map(value.bets.map(bet=>[bet.id,bet]));paperBets.forEach(bet=>merged.set(bet.id,bet));paperBets=[...merged.values()].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));if(!hadLocal&&Number(value.bankroll)>0)paperBankroll=Number(value.bankroll)}savePaperState();renderBetLab()});
