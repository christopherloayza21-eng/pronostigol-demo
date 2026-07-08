const tournamentState={date:"",group:"",round:"",team:""};
const escapeText=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

function limaTime(match){
  const found=(match.time||"").match(/^(\d{1,2}):(\d{2})\s+UTC([+-]\d+)$/i);if(!found)return match.time||"Hora pendiente";
  const [y,m,d]=match.date.split("-").map(Number),hour=+found[1],minute=+found[2],offset=+found[3];
  const instant=new Date(Date.UTC(y,m-1,d,hour-offset,minute));
  return new Intl.DateTimeFormat("es-PE",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"America/Lima"}).format(instant);
}
function dateLabel(date){return new Intl.DateTimeFormat("es-PE",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}
function knownTeam(name){return teams.some(t=>t.name===name)}

function initializeTournamentHub(){
  if(!localWorldCupData)return;$("#tournamentHub").classList.remove("hidden");
  const matches=localWorldCupData.matches,dates=[...new Set(matches.map(m=>m.date))].sort(),today=new Date().toLocaleDateString("en-CA",{timeZone:"America/Lima"});
  tournamentState.date=dates.includes(today)?today:(dates.find(d=>d>today)||dates[0]);$("#fixtureDate").value=tournamentState.date;
  const groups=[...new Set(teams.map(t=>t.group))],rounds=[...new Set(matches.map(m=>m.round))];
  $("#fixtureGroup").innerHTML='<option value="">Todos los grupos</option>'+groups.map(x=>`<option>${escapeText(x)}</option>`).join("");
  $("#standingGroup").innerHTML=groups.map(x=>`<option>${escapeText(x)}</option>`).join("");
  $("#fixtureRound").innerHTML='<option value="">Todas las fases</option>'+rounds.map(x=>`<option>${escapeText(x)}</option>`).join("");
  $("#fixtureTeam").innerHTML='<option value="">Todas las selecciones</option>'+teams.map(x=>`<option>${escapeText(x.name)}</option>`).join("");
  $("#fixtureTotal").textContent=`${matches.length} partidos`;renderTournamentHub();
}
function renderTournamentHub(){renderResolvedFixtureCards();renderStandings();renderRanking();renderResolvedBracket()}
function renderFixtureCards(){
  const filtered=localWorldCupData.matches.filter(m=>m.date===tournamentState.date&&(!tournamentState.group||m.group===tournamentState.group)&&(!tournamentState.round||m.round===tournamentState.round)&&(!tournamentState.team||m.team1===tournamentState.team||m.team2===tournamentState.team));
  if(!filtered.length){$("#fixtureGrid").innerHTML=`<div class="fixture-empty">No hay partidos con estos filtros el ${escapeText(dateLabel(tournamentState.date))}.</div>`;return}
  $("#fixtureGrid").innerHTML=filtered.map((m,index)=>{const done=Array.isArray(m.score?.ft),score=done?`${m.score.ft[0]}–${m.score.ft[1]}`:"VS";return `<article class="fixture-card ${done?"completed":""}" data-index="${localWorldCupData.matches.indexOf(m)}"><div class="fixture-meta"><span>${escapeText(dateLabel(m.date))} · ${limaTime(m)}</span><span>${escapeText(m.group||m.round)}</span></div><div class="fixture-teams"><div class="fixture-team"><b>${escapeText(m.team1)}</b><small>${escapeText(m.ground||"")}</small></div><div class="fixture-score">${score}</div><div class="fixture-team"><b>${escapeText(m.team2)}</b><small>${escapeText(m.round)}</small></div></div><div class="fixture-action"><span>${done?"Resultado final":"Pronóstico disponible"}</span><b>${knownTeam(m.team1)&&knownTeam(m.team2)?"Ver análisis →":"Participantes pendientes"}</b></div></article>`}).join("");
}
function groupStandings(group){
  const names=teams.filter(t=>t.group===group).map(t=>t.name),table=Object.fromEntries(names.map(n=>[n,{name:n,pj:0,w:0,d:0,l:0,gf:0,ga:0,pts:0}]));
  localWorldCupData.matches.filter(m=>m.group===group&&table[m.team1]&&table[m.team2]&&Array.isArray(m.score?.ft)).forEach(m=>{const a=table[m.team1],b=table[m.team2],[x,y]=m.score.ft;a.pj++;b.pj++;a.gf+=x;a.ga+=y;b.gf+=y;b.ga+=x;if(x>y){a.w++;b.l++;a.pts+=3}else if(x<y){b.w++;a.l++;b.pts+=3}else{a.d++;b.d++;a.pts++;b.pts++}});
  return Object.values(table).sort((a,b)=>b.pts-a.pts||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf);
}
function renderStandings(){const group=$("#standingGroup").value||teams[0]?.group;if(!group)return;const rows=groupStandings(group);$("#standingsTable").innerHTML=`<table class="standings-table"><thead><tr><th>Selección</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}. ${escapeText(r.name)}</td><td>${r.pj}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf-r.ga}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table>`}
function renderRanking(){const list=Object.entries(teamRatings).sort((a,b)=>b[1]-a[1]);$("#rankingList").innerHTML=list.slice(0,12).map(([name,value],i)=>`<button class="ranking-row" data-team="${escapeText(name)}"><i>${i+1}</i><span>${escapeText(name)}</span><b>${Math.round(value)}</b></button>`).join("")}
function renderBracket(){const grid=$("#bracketGrid");if(!grid)return;const knockout=(localWorldCupData?.matches||[]).filter(m=>!/matchday/i.test(m.round));grid.innerHTML=knockout.length?knockout.map(m=>`<div class="bracket-match"><span>${escapeText(m.date)} · ${escapeText(m.round)}</span><b>${escapeText(m.team1)}</b><br>${escapeText(m.team2)}</div>`).join(""):'<div class="fixture-empty">Carga “Mundial incluido” para ver el cuadro eliminatorio.</div>'}
function groupCode(group){return (String(group||"").match(/Group\s+([A-L])/i)||[])[1]?.toUpperCase()||""}
function groupCompletion(group){
  const matches=(localWorldCupData?.matches||[]).filter(m=>m.group===group);
  return {played:matches.filter(m=>Array.isArray(m.score?.ft)).length,total:matches.length,complete:matches.length>0&&matches.every(m=>Array.isArray(m.score?.ft))}
}
function buildQualifierMap(){
  const groups=[...new Set(teams.map(t=>t.group).filter(Boolean))],direct={},thirds=[],notes=[];
  groups.forEach(group=>{
    const code=groupCode(group),rows=groupStandings(group),status=groupCompletion(group);
    if(!code||!rows.length)return;
    direct[`1${code}`]=rows[0]?.name||null;direct[`2${code}`]=rows[1]?.name||null;
    if(rows[2])thirds.push({...rows[2],group:code,slot:`3${code}`,complete:status.complete});
    if(!status.complete)notes.push(`${code}: ${status.played}/${status.total}`);
  });
  thirds.sort((a,b)=>b.pts-a.pts||(b.gf-b.ga)-(a.gf-a.ga)||b.gf-a.gf||a.name.localeCompare(b.name));
  return {direct,thirds,complete:!notes.length,notes};
}
function resolveBracketSlot(slot,context,usedThirds,knockoutByNumber){
  const raw=String(slot||"").trim();
  if(knownTeam(raw))return {name:raw,raw,status:"real"};
  const rank=raw.match(/^([12])([A-L])$/i);
  if(rank){const key=`${rank[1]}${rank[2].toUpperCase()}`,name=context.direct[key];return {name:name||raw,raw,status:name?"resolved":"pending"}}
  const third=raw.match(/^3([A-L](?:\/[A-L])*)$/i);
  if(third){
    const candidates=third[1].toUpperCase().split("/");
    const pick=context.thirds.find(x=>candidates.includes(x.group)&&!usedThirds.has(x.group));
    if(pick){usedThirds.add(pick.group);return {name:pick.name,raw:`${pick.slot} de ${raw}`,status:context.complete?"resolved":"projected"}}
    return {name:raw,raw,status:"pending"};
  }
  const knockout=raw.match(/^([WL])(\d+)$/i);
  if(knockout){
    const source=knockoutByNumber[knockout[2]],name=knockout[1].toUpperCase()==="W"?source?.winner:source?.loser;
    return {name:name||raw,raw,status:name?"resolved":"pending"};
  }
  return {name:raw,raw,status:"pending"};
}
const officialRound32={
  73:["South Africa","Canada"],74:["Germany","Paraguay"],75:["Netherlands","Morocco"],76:["Brazil","Japan"],
  77:["France","Sweden"],78:["Ivory Coast","Norway"],79:["Mexico","Ecuador"],80:["England","DR Congo"],
  81:["USA","Bosnia & Herzegovina"],82:["Belgium","Senegal"],83:["Portugal","Croatia"],84:["Spain","Austria"],
  85:["Switzerland","Algeria"],86:["Argentina","Cape Verde"],87:["Colombia","Ghana"],88:["Australia","Egypt"]
};
function buildResolvedBracket(){
  const knockout=(localWorldCupData?.matches||[]).filter(m=>!/matchday/i.test(m.round)),context=buildQualifierMap(),usedThirds=new Set(),knockoutByNumber={};
  return {context,matches:knockout.map((m,index)=>{
    const matchNo=73+index,official=officialRound32[matchNo];
    let home=resolveBracketSlot(m.team1,context,usedThirds,knockoutByNumber),away=resolveBracketSlot(m.team2,context,usedThirds,knockoutByNumber),score=Array.isArray(m.score?.ft)?m.score.ft:null;
    if(official){home={name:official[0],raw:m.team1,status:"real"};away={name:official[1],raw:m.team2,status:"real"}}
    if(score&&home.status!=="pending"&&away.status!=="pending"){
      const homeWins=score[0]>score[1],awayWins=score[1]>score[0],qualified=m.score?.qualified;
      const winner=homeWins||qualified==="home"?home.name:awayWins||qualified==="away"?away.name:null;
      const loser=winner===home.name?away.name:winner===away.name?home.name:null;
      knockoutByNumber[matchNo]={winner,loser};
    }
    return {...m,matchNo,resolvedHome:home,resolvedAway:away};
  })};
}
function bracketTeamHtml(team){
  const cls=team.status==="pending"?"pending":team.status==="projected"?"projected":"resolved",source=team.raw&&team.raw!==team.name?`<small>${escapeText(team.raw)}</small>`:"";
  return `<b class="${cls}">${escapeText(team.name)}</b>${source}`;
}
function renderResolvedBracket(){
  const grid=$("#bracketGrid");if(!grid)return;const {context,matches}=buildResolvedBracket();
  if(!matches.length){grid.innerHTML='<div class="fixture-empty">Carga "Mundial incluido" para ver el cuadro eliminatorio.</div>';return}
  const status=context.complete?"Cruces calculados con tabla completa":`Cruces provisionales: faltan resultados (${context.notes.join(", ")})`;
  grid.innerHTML=`<div class="bracket-status">${escapeText(status)}</div>`+matches.map(m=>{const done=Array.isArray(m.score?.ft),pens=Array.isArray(m.score?.penalties)?`<small>Pen. ${m.score.penalties[0]}-${m.score.penalties[1]}</small>`:"",score=done?`<em>${m.score.ft[0]}-${m.score.ft[1]}</em>${pens}`:"<em>vs</em>";return `<div class="bracket-match ${done?"completed":""}"><span>${escapeText(m.date)} · Partido ${m.matchNo} · ${escapeText(m.round)}</span><div class="bracket-teams"><div>${bracketTeamHtml(m.resolvedHome)}</div><div class="bracket-scorebox">${score}</div><div>${bracketTeamHtml(m.resolvedAway)}</div></div></div>`}).join("")
}
function fixtureResolvedView(match){
  if(/matchday/i.test(match.round))return {team1:match.team1,team2:match.team2,ready:knownTeam(match.team1)&&knownTeam(match.team2),source1:"",source2:""};
  const found=buildResolvedBracket().matches.find(m=>m.date===match.date&&m.round===match.round&&m.team1===match.team1&&m.team2===match.team2);
  if(!found)return {team1:match.team1,team2:match.team2,ready:knownTeam(match.team1)&&knownTeam(match.team2),source1:"",source2:""};
  return {team1:found.resolvedHome.name,team2:found.resolvedAway.name,ready:knownTeam(found.resolvedHome.name)&&knownTeam(found.resolvedAway.name),source1:found.resolvedHome.raw!==found.resolvedHome.name?found.resolvedHome.raw:"",source2:found.resolvedAway.raw!==found.resolvedAway.name?found.resolvedAway.raw:""};
}
function renderResolvedFixtureCards(){
  const filtered=localWorldCupData.matches.filter(m=>{
    const view=fixtureResolvedView(m);
    return m.date===tournamentState.date&&(!tournamentState.group||m.group===tournamentState.group)&&(!tournamentState.round||m.round===tournamentState.round)&&(!tournamentState.team||m.team1===tournamentState.team||m.team2===tournamentState.team||view.team1===tournamentState.team||view.team2===tournamentState.team);
  });
  if(!filtered.length){$("#fixtureGrid").innerHTML=`<div class="fixture-empty">No hay partidos con estos filtros el ${escapeText(dateLabel(tournamentState.date))}.</div>`;return}
  $("#fixtureGrid").innerHTML=filtered.map(m=>{
    const done=Array.isArray(m.score?.ft),score=done?`${m.score.ft[0]}-${m.score.ft[1]}`:"VS",view=fixtureResolvedView(m);
    return `<article class="fixture-card ${done?"completed":""}" data-index="${localWorldCupData.matches.indexOf(m)}"><div class="fixture-meta"><span>${escapeText(dateLabel(m.date))} · ${limaTime(m)}</span><span>${escapeText(m.group||m.round)}</span></div><div class="fixture-teams"><div class="fixture-team"><b>${escapeText(view.team1)}</b><small>${escapeText(view.source1||m.ground||"")}</small></div><div class="fixture-score">${score}</div><div class="fixture-team"><b>${escapeText(view.team2)}</b><small>${escapeText(view.source2||m.round)}</small></div></div><div class="fixture-action"><span>${done?"Resultado final":"Pronóstico disponible"}</span><b>${view.ready?"Ver análisis →":"Participantes pendientes"}</b></div></article>`
  }).join("");
}
function teamProfile(name,opponent=null){
  const profile=localWorldCupData.footy?.teams?.[name],history=localWorldCupData.history?.teams?.[name]?.matches||[];if(!profile)return;
  const h2h=opponent?history.filter(m=>m.opponent===opponent):[];
  $("#teamProfilePanel").innerHTML=`<div class="panel-title"><h3>Perfil de ${escapeText(name)}</h3><span>Elo ${Math.round(teamRatings[name]||1500)}</span></div><div class="profile-grid"><div class="profile-stat"><span>PUNTOS/PARTIDO</span><b>${profile.ppg.toFixed(2)}</b></div><div class="profile-stat"><span>PORTERÍA A CERO</span><b>${percent(profile.clean_sheet_rate)}</b></div><div class="profile-stat"><span>AMBOS MARCAN</span><b>${percent(profile.btts_rate)}</b></div><div class="profile-stat"><span>CÓRNERS</span><b>${profile.corners_avg.toFixed(1)}</b></div></div><div class="h2h-list">${h2h.length?h2h.map(m=>`<div class="h2h-match">${escapeText(m.date)} · ${escapeText(name)} ${m.gf}–${m.ga} ${escapeText(opponent)}</div>`).join(""):'<div class="h2h-match">Sin enfrentamientos directos en la muestra reciente.</div>'}</div>`;
  $("#teamProfilePanel").classList.remove("hidden");
}

function renderDecisionSupport(home,away,r){
  const leader=r.hp>r.ap&&r.hp>r.dp?home.name:r.ap>r.hp&&r.ap>r.dp?away.name:"Empate",ratingGap=Math.round(r.ratingHome-r.ratingAway);
  const reasons=[`${leader==="Empate"?"El partido aparece equilibrado":leader+" lidera el 1X2"}: ${percent(Math.max(r.hp,r.dp,r.ap))} en la simulación.`,`Confianza integral ${r.confidenceScore}/100: ${r.confidenceFactors.join("; ")}.`,`${home.name} llega con ${r.hs.ppg.toFixed(2)} puntos por partido ponderados y ${away.name} con ${r.as.ppg.toFixed(2)}.`,`Producción esperada: ${home.name} ${r.xh.toFixed(2)} goles y ${away.name} ${r.xa.toFixed(2)}.`,`Ranking Elo: ${home.name} ${Math.round(r.ratingHome)} frente a ${away.name} ${Math.round(r.ratingAway)} (${ratingGap>=0?"+":""}${ratingGap}).`,r.neutral?"La sede se trata como neutral; no se aplicó ventaja local.":"Se aplicó una ventaja local moderada."];
  if(r.matchContext?.notes?.length)reasons.push(...r.matchContext.notes.map(x=>`${x}.`));
  const auditRisks=(currentPrediction?.dataAudit?.alerts||[]).filter(x=>x.code!=="no_major_flags").map(x=>x.message);
  const risks=[`Un gol temprano de ${leader===home.name?away.name:home.name} cambiaría el guion y obligaría al favorito a exponerse.`,`Una expulsión, penal o error de portero puede romper un modelo basado en promedios.`,`El marcador exacto depende de la definición: los goles reales pueden separarse de los goles esperados.`,`Córners y tarjetas provienen de perfiles agregados, no de los 10 partidos completos de cada selección.`,`La muestra reciente tiene solo 10 partidos por equipo; el modelo expresa probabilidad, no certeza.`,...auditRisks.slice(0,3)];
  if(currentPrediction)currentPrediction.explanation={reasons:[...reasons],failureScenarios:[...risks]};
  $("#explanationPanel").innerHTML=`<div class="panel-title"><h3>Por qué sale este pronóstico</h3><span>Argumentos y condiciones de fallo</span></div><div class="argument-list">${reasons.map(x=>`<div class="argument-item">${escapeText(x)}</div>`).join("")}</div><div class="panel-title"><h3>¿Qué tendría que pasar para que falle?</h3></div><div class="argument-list risk-list">${risks.map(x=>`<div class="argument-item">${escapeText(x)}</div>`).join("")}</div>`;
  renderModelIntelligence(home,away);
  renderBetIdeas(home,away,r);
}

function renderModelIntelligence(home,away){
  const panel=$("#modelIntelligencePanel"),shadow=currentPrediction?.shadowEnsemble,audit=currentPrediction?.dataAudit;if(!panel||!shadow||!audit)return;
  const labels={home:home.name,draw:"Empate",away:away.name},models=[["Modelo 2.6",shadow.components.poisson,"oficial"],["Elo independiente",shadow.components.elo,"sombra"],["Forma reciente",shadow.components.form,"sombra"],["Ensemble 0.1",shadow.probabilities,"sombra"]],leader=Object.entries(shadow.probabilities).sort((a,b)=>b[1]-a[1])[0],levelLabels={alto:"Riesgo estadístico alto",medio:"Revisar advertencias",bajo:"Riesgo estadístico bajo"};
  const modelHtml=models.map(([name,p,status])=>`<div class="shadow-model ${status}"><div><small>${escapeText(name)} · ${status.toUpperCase()}</small><b>${escapeText(labels[Object.entries(p).sort((a,b)=>b[1]-a[1])[0][0]])}</b></div><span>${percent(p.home)} · ${percent(p.draw)} · ${percent(p.away)}</span></div>`).join("");
  const alerts=audit.alerts.map(x=>`<div class="trap-alert ${x.severity}"><i>${x.severity==="high"?"!":x.severity==="medium"?"△":"i"}</i><span>${escapeText(x.message)}</span></div>`).join("");
  panel.innerHTML=`<div class="panel-title"><div><small>CONTROL AVANZADO</small><h3>Ensemble experimental y detector de trampas</h3></div><span class="audit-level ${audit.level}">${escapeText(levelLabels[audit.level])} · ${audit.score}/100</span></div><div class="intelligence-summary"><div><span>LECTURA DEL ENSEMBLE</span><b>${escapeText(labels[leader[0]])} ${percent(leader[1])}</b><small>Acuerdo ${shadow.agreement} entre modelos</small></div><p>Funciona en sombra: compara métodos, pero <b>no cambia el pronóstico oficial ni las apuestas</b>. Sus pesos permanecerán congelados hasta superar el backtesting cronológico.</p></div><div class="shadow-models">${modelHtml}</div><div class="trap-alerts">${alerts}</div>`;
}
function renderBetIdeas(home,away,r){
  const market=(name,p,group,extra={})=>({name,p:clamp(p,0,1),group,...extra}),outcomeLeader=r.hp>=r.ap?home.name:away.name,cardSamples=predictionHistory.filter(x=>Number.isFinite(x.actual?.cards)).length;
  const a=home.marketStats,b=away.marketStats;
  const profileAvg=key=>a&&b&&Number.isFinite(a[key])&&Number.isFinite(b[key])?(a[key]+b[key])/2:null;
  const candidates=[
    market(`${home.name} o empate`,r.dcHome,"resultado"),market(`${away.name} o empate`,r.dcAway,"resultado"),market("Sin empate",r.noDraw,"resultado"),
    market("Más de 1.5 goles",r.over15,"goles"),market("Menos de 1.5 goles",1-r.over15,"goles"),market("Más de 2.5 goles",r.over,"goles"),market("Menos de 2.5 goles",1-r.over,"goles"),market("Más de 3.5 goles",r.over35,"goles"),market("Menos de 3.5 goles",1-r.over35,"goles"),
    market("Ambos marcan: sí",r.btts,"ambos marcan"),market("Ambos marcan: no",1-r.btts,"ambos marcan"),
    market(`${home.name} deja su portería a cero`,r.homeClean,"portería"),market(`${away.name} deja su portería a cero`,r.awayClean,"portería")
  ];
  [["7_5","7.5"],["8_5","8.5"],["9_5","9.5"],["10_5","10.5"],["11_5","11.5"]].forEach(([key,label])=>{const p=calibrateMarketProbability(profileAvg(`corners_${key}plus`),"corners");if(p!==null)candidates.push(market(`Más de ${label} córners`,p,"córners"),market(`Menos de ${label} córners`,1-p,"córners"))});
  [["1_5","1.5"],["2_5","2.5"],["3_5","3.5"],["4_5","4.5"],["5_5","5.5"]].forEach(([key,label])=>{const p=calibrateMarketProbability(profileAvg(`cards_${key}plus`),"cards");if(p!==null)candidates.push(market(`Más de ${label} tarjetas`,.5+(p-.5)*.55,"tarjetas",{experimental:true}),market(`Menos de ${label} tarjetas`,.5+((1-p)-.5)*.55,"tarjetas",{experimental:true}))});
  Object.values(currentPrediction?.statMarkets||{}).forEach(group=>(group.lines||[]).filter(x=>x.probability>=.5).forEach(line=>candidates.push(market(line.label,line.probability,line.stat==="fouls"?"faltas":line.stat==="shots"?"tiros":"tiros al arco",{estimated:true,sample:line.sample}))));
  const byProbability=(x,y)=>y.p-x.p||x.name.localeCompare(y.name);
  const balancedTop=(pool,limit,requiredGroups)=>{const sorted=[...pool].sort(byProbability),selected=sorted.slice(0,limit);requiredGroups.forEach(group=>{if(selected.some(x=>x.group===group))return;const replacement=sorted.find(x=>x.group===group&&!selected.includes(x));if(replacement)selected[selected.length-1]=replacement});return [...new Map(selected.map(x=>[x.name,x])).values()].sort(byProbability)};
  let conservative=balancedTop(candidates.filter(x=>x.p>=.58&&x.group!=="tarjetas"),10,["resultado","goles","córners"]);
  const riskyPool=[...candidates.filter(x=>x.p<.58),market(`Victoria de ${outcomeLeader}`,Math.max(r.hp,r.ap),"resultado"),market(`Marcador exacto ${r.best.h}–${r.best.a}`,r.best.p,"marcador")];
  let risky=balancedTop(riskyPool,10,["resultado","goles","córners","tarjetas","marcador"]);
  const bestByGroup=group=>conservative.find(x=>x.group===group)||candidates.filter(x=>x.group===group).sort(byProbability)[0];
  const combine=(parts,penalty=.9)=>{const valid=parts.filter(Boolean);return valid.length>=2?market(valid.map(x=>x.name).join(" + "),valid.reduce((p,x)=>p*x.p,1)*penalty,"combinada",{experimental:valid.some(x=>x.experimental)}):null};
  const resultPick=bestByGroup("resultado"),goalsPick=bestByGroup("goles"),cornerPick=bestByGroup("córners"),cardPick=bestByGroup("tarjetas");
  let conservativeCombinations=[combine([resultPick,goalsPick]),combine([resultPick,cornerPick]),combine([goalsPick,cornerPick])].filter(Boolean).sort(byProbability);
  let riskyCombinations=[
    combine([market(`Victoria de ${outcomeLeader}`,Math.max(r.hp,r.ap),"resultado"),market("Más de 2.5 goles",r.over,"goles")],.84),
    combine([market(`Victoria de ${outcomeLeader}`,Math.max(r.hp,r.ap),"resultado"),cornerPick,cardPick],.78),
    combine([market("Ambos marcan: sí",r.btts,"ambos marcan"),market("Más de 2.5 goles",r.over,"goles"),cornerPick],.78),
    combine([market(`Marcador exacto ${r.best.h}–${r.best.a}`,r.best.p,"marcador"),cardPick],.76),
    combine([market("Más de 3.5 goles",r.over35,"goles"),cornerPick,cardPick],.74),
    combine([market("Ambos marcan: sí",r.btts,"ambos marcan"),cornerPick,cardPick],.74)
  ].filter(Boolean).sort(byProbability);
  if(playableOnlyMode){
    const playable=x=>x.p>=.6&&!x.experimental&&x.group!=="marcador";
    conservative=conservative.filter(playable);
    risky=risky.filter(playable);
    conservativeCombinations=conservativeCombinations.filter(x=>x.p>=.35&&!x.experimental);
    riskyCombinations=riskyCombinations.filter(x=>x.p>=.35&&!x.experimental);
  }
  if(currentPrediction)currentPrediction.betIdeas={conservativeSingles:conservative,riskySingles:risky,conservativeCombinations,riskyCombinations};
  const render=(items,risk=false)=>items.map(x=>`<div class="bet-pick ${risk?"risky":""} ${x.experimental?"experimental":""}"><span>${escapeText(x.name)}${x.experimental?' <em>EXPERIMENTAL</em>':""}</span><b>${percent(x.p)}</b></div>`).join("");
  const official=Object.entries(currentPrediction?.officialPicks||{}).filter(([,pick])=>pick),officialNames={winner:"1X2",exact:"Marcador",goals:"Goles",btts:"Ambos marcan",corners:"Córners",cards:"Tarjetas",shots:"Tiros",shotsOnTarget:"Tiros al arco",fouls:"Faltas"},officialHtml=official.map(([key,pick])=>`<div class="official-pick ${pick.experimental?"experimental":""} ${pick.abstain?"abstain":""}"><small>${officialNames[key]||key}</small><span>${escapeText(pick.label)}${pick.experimental?' <em>EXPERIMENTAL</em>':pick.abstain?' <em>NO APOSTAR</em>':pick.sample?` <em>ESTIMADO · n=${pick.sample}</em>`:""}</span><b>${pick.abstain?`Sí ${percent(pick.yesProbability)} · No ${percent(pick.noProbability)}`:percent(pick.probability)}</b></div>`).join("");
  $("#bettingPanel").innerHTML=`<div class="panel-title"><h3>Pronósticos oficiales del partido</h3><span>Modelo ${currentPrediction.modelVersion} · líneas dinámicas</span></div><div class="official-picks">${officialHtml}</div><p class="bet-disclaimer">Sin cuotas, el sistema elige una línea conservadora cercana al 68% de probabilidad. Con una cuota externa, el Laboratorio decide si esa probabilidad ofrece valor. El historial conserva la línea que estaba vigente cuando se guardó cada pronóstico.</p><div class="panel-title"><h3>Otras ideas estadísticas</h3><span>${playableOnlyMode?"Solo jugables":"Ordenadas de mayor a menor porcentaje"}</span></div><p class="bet-disclaimer">${playableOnlyMode?"Filtro activo: mínimo 60%, sin experimentales ni marcador exacto.":"Las tarjetas permanecen como mercado experimental: muestra actual "+cardSamples+"/30 para iniciar su recalibración. No existen apuestas seguras y las combinadas pueden estar relacionadas."}</p><div class="bet-sections"><div class="bet-group"><h4>INDIVIDUALES · CONSERVADORAS</h4>${render(conservative)||"<p class='bet-disclaimer'>Sin picks jugables.</p>"}</div><div class="bet-group"><h4>INDIVIDUALES · ARRIESGADAS</h4>${render(risky,true)||"<p class='bet-disclaimer'>Sin picks jugables.</p>"}</div><div class="bet-group"><h4>COMBINADAS · CONSERVADORAS</h4>${render(conservativeCombinations)||"<p class='bet-disclaimer'>Sin combinadas jugables.</p>"}</div><div class="bet-group"><h4>COMBINADAS · ARRIESGADAS</h4>${render(riskyCombinations,true)||"<p class='bet-disclaimer'>Sin combinadas jugables.</p>"}</div></div>`;
}

$("#fixtureGrid").addEventListener("click",event=>{const card=event.target.closest(".fixture-card");if(!card||!localWorldCupData)return;const match=localWorldCupData.matches[+card.dataset.index],view=fixtureResolvedView(match);if(!view.ready)return;const resolvedMatch={...match,team1:view.team1,team2:view.team2};selectedFixture=fixtureContext(resolvedMatch);$("#homeTeam").value=view.team1;$("#awayTeam").value=view.team2;$(".crest.home").textContent=initials(view.team1);$(".crest.away").textContent=initials(view.team2);if(typeof renderPrematchPanel==="function")renderPrematchPanel();teamProfile(view.team1,view.team2);$("#analyze").click()});
$("#fixtureDate").addEventListener("change",e=>{tournamentState.date=e.target.value;renderResolvedFixtureCards()});
$("#previousDay").onclick=()=>shiftFixtureDay(-1);$("#nextDay").onclick=()=>shiftFixtureDay(1);
function shiftFixtureDay(amount){const d=new Date(`${tournamentState.date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+amount);tournamentState.date=d.toISOString().slice(0,10);$("#fixtureDate").value=tournamentState.date;renderResolvedFixtureCards()}
$("#todayFixtures").onclick=()=>{tournamentState.date=new Date().toLocaleDateString("en-CA",{timeZone:"America/Lima"});$("#fixtureDate").value=tournamentState.date;renderResolvedFixtureCards()};
[["#fixtureGroup","group"],["#fixtureRound","round"],["#fixtureTeam","team"]].forEach(([selector,key])=>$(selector).addEventListener("change",e=>{tournamentState[key]=e.target.value;renderResolvedFixtureCards();if(key==="team"&&e.target.value)teamProfile(e.target.value)}));
$("#standingGroup").addEventListener("change",renderStandings);
$("#rankingList").addEventListener("click",event=>{const row=event.target.closest(".ranking-row");if(row)teamProfile(row.dataset.team)});
