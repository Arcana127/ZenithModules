// ============================================================
//  Zenith Academy Scroll v1.5
//  Foundry VTT v13+ — Conversation system, split storage,
//  group chats, toast notifications, VN relationships, auto-timestamps
// ============================================================
const M="zenith-scroll",FP="iconPosition";

// Flag sub-keys for split storage
const F={
  profile:"profile",    // studentId, year, cohort, dormitory, status, statusPreset
  academic:"academic",  // schedule, gift, giftDescription, giftLevel, giftMilestones, nextEvent, nextEventDays, notes
  social:"social",      // conversations, relationships
  media:"media",        // gallery
  system:"system"       // announcements, dismissedAnnouncements
};

// ---- Relationship scale ----
const REL_SCALE=[
  {val:-5,label:"Nemesis",color:"#a02020"},{val:-4,label:"Hated",color:"#c03030"},
  {val:-3,label:"Hostile",color:"#d05040"},{val:-2,label:"Cold",color:"#b07060"},
  {val:-1,label:"Wary",color:"#908070"},{val:0,label:"Neutral",color:"#808080"},
  {val:1,label:"Cordial",color:"#6a8870"},{val:2,label:"Friendly",color:"#509050"},
  {val:3,label:"Close",color:"#40a060"},{val:4,label:"Trusted",color:"#c0a030"},
  {val:5,label:"Devoted",color:"#d4940a"}
];
function relInfo(r){return REL_SCALE.find(x=>x.val===r)??REL_SCALE[5];}

// ---- Helpers ----
function el(tag,at={},ch=[]){const e=document.createElement(tag);for(const[k,v] of Object.entries(at)){if(k==="class")e.className=v;else if(k==="html")e.innerHTML=v;else if(k==="text")e.textContent=v;else if(k==="style"&&typeof v==="object")Object.assign(e.style,v);else if(k.startsWith("on")&&typeof v==="function")e.addEventListener(k.slice(2),v);else e.setAttribute(k,v);}for(const c of ch){if(typeof c==="string")e.append(c);else if(c)e.appendChild(c);}return e;}
function genId(){const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s="";for(let i=0;i<7;i++)s+=c[Math.floor(Math.random()*c.length)];return"ZA-"+s;}
function convId(){return"conv_"+Math.random().toString(36).slice(2,10);}
function getMarks(a){if(!a)return 0;const i=a.items.find(x=>x.name?.toLowerCase()==="marks");return i?.system?.quantity??0;}
function playerActor(){if(!game.user.isGM)return game.user.character;return canvas.tokens?.controlled?.[0]?.actor??game.user.character;}
function yearLabel(y){return{1:"First Year",2:"Second Year",3:"Third Year",4:"Fourth Year"}[y]??`Year ${y}`;}
function resolvePortrait(name){
  // Check actor directory for portrait
  const actor=game.actors.getName(name);
  if(actor?.img)return actor.img;
  return null;
}
function findPortrait(name,relationships){
  const rel=(relationships??[]).find(r=>r.name===name);
  if(rel?.img)return rel.img;
  return resolvePortrait(name);
}
function getAutoTime(){
  try{if(window.SimpleCalendar?.api){const dt=SimpleCalendar.api.currentDateTimeDisplay();if(dt?.time)return dt.time;}}catch(e){}
  const wt=game.time.worldTime;
  if(wt>0){const total=wt%86400;const h=Math.floor(total/3600);const m=Math.floor((total%3600)/60);const ampm=h>=12?"PM":"AM";const h12=h%12||12;return`${h12}:${String(m).padStart(2,"0")} ${ampm}`;}
  return"";
}

// ---- Default data per sub-key ----
function defaultProfile(){return{studentId:"",year:1,cohort:"",dormitory:"",status:"",statusPreset:"available"};}
function defaultAcademic(){return{schedule:[{period:"First Bell",course:"",instructor:"",location:""},{period:"Second Bell",course:"",instructor:"",location:""},{period:"Third Bell",course:"",instructor:"",location:""},{period:"Fourth Bell",course:"",instructor:"",location:""},{period:"Fifth Bell",course:"",instructor:"",location:""}],gift:"",giftDescription:"",giftLevel:1,giftMilestones:[],nextEvent:"",nextEventDays:0,notes:""};}
function defaultSocial(){return{conversations:[],relationships:[]};}
function defaultMedia(){return{gallery:[]};}
function defaultSystem(){return{announcements:[],dismissedAnnouncements:[]};}

// ---- Load/save per section ----
function loadSection(actor,section){
  if(!actor)return null;
  const stored=actor.getFlag(M,section);
  const defaults={[F.profile]:defaultProfile,[F.academic]:defaultAcademic,[F.social]:defaultSocial,[F.media]:defaultMedia,[F.system]:defaultSystem};
  const def=defaults[section]?.();
  if(!def)return stored??{};
  if(!stored)return JSON.parse(JSON.stringify(def));
  // Merge stored over defaults
  const result=JSON.parse(JSON.stringify(def));
  for(const k of Object.keys(result)){if(stored[k]!==undefined&&stored[k]!==null)result[k]=JSON.parse(JSON.stringify(stored[k]));}
  return result;
}

async function saveSection(actor,section,data){
  // Use nested object notation to avoid dot-path issues with hyphenated module name
  const clone=JSON.parse(JSON.stringify(data));
  await actor.update({flags:{[M]:{[section]:clone}}});
}

// Convenience: load all sections at once
function loadAll(actor){
  const p=loadSection(actor,F.profile);
  if(!p.studentId){p.studentId=genId();saveSection(actor,F.profile,p);}
  return{
    ...p,
    ...loadSection(actor,F.academic),
    ...loadSection(actor,F.social),
    ...loadSection(actor,F.media),
    ...loadSection(actor,F.system)
  };
}

// ---- Migration from v7 flat format ----
async function migrateIfNeeded(actor){
  const oldData=actor.getFlag(M,"studentData");
  if(!oldData)return; // Nothing to migrate or already clean
  // Check if new format already exists
  if(actor.getFlag(M,F.profile))return; // Already migrated
  console.log(`${M} | Migrating ${actor.name} from v7 format...`);

  const profile={studentId:oldData.studentId||genId(),year:oldData.year||1,cohort:oldData.cohort||"",dormitory:oldData.dormitory||"",status:oldData.status||"",statusPreset:"available"};

  const academic={schedule:oldData.schedule||defaultAcademic().schedule,gift:oldData.gift||"",giftDescription:oldData.giftDescription||"",giftLevel:oldData.giftLevel||1,giftMilestones:oldData.giftMilestones||[],nextEvent:oldData.nextEvent||"",nextEventDays:oldData.nextEventDays||0,notes:oldData.notes||""};

  // Convert old messages to conversations
  const conversations=[];
  const oldMsgs=oldData.messages||[];
  const threads={};
  for(const m of oldMsgs){
    if(m.broadcast)continue;
    const threadName=m._replyTo||m.sender||"Unknown";
    if(threadName.startsWith("["))continue;
    if(!threads[threadName])threads[threadName]=[];
    threads[threadName].push({from:m._replyTo?actor.name:m.sender,text:m.text||"",time:m.time||"",image:m.image||"",read:m.read??true,sent:!!m._replyTo});
  }
  for(const[name,msgs] of Object.entries(threads)){
    conversations.push({id:convId(),participants:[actor.name,name],title:null,isGroup:false,messages:msgs,muted:false});
  }

  const social={conversations,relationships:oldData.relationships||[]};
  const media={gallery:oldData.gallery||[]};
  const system={announcements:oldData.announcements||[],dismissedAnnouncements:oldData.dismissedBroadcasts||[]};

  await saveSection(actor,F.profile,profile);
  await saveSection(actor,F.academic,academic);
  await saveSection(actor,F.social,social);
  await saveSection(actor,F.media,media);
  await saveSection(actor,F.system,system);
  // Clean old flag
  try{await actor.unsetFlag(M,"studentData");}catch(e){}
  console.log(`${M} | Migration complete for ${actor.name}`);
}


// ============================================================
//  SETTINGS
// ============================================================
function registerSettings(){
  game.settings.register(M,"galleryFolder",{name:"Gallery Image Folder",hint:"Default folder path for browsing gallery images.",scope:"world",config:true,type:String,default:"scroll-gallery"});
  game.settings.register(M,"enablePlayerMessaging",{name:"Player-to-Player Messaging",hint:"Allow students to message each other. GM client must be connected to relay.",scope:"world",config:true,type:Boolean,default:true});
}


// ============================================================
//  SOCKET SYSTEM
// ============================================================
function initSocket(){
  game.socket.on(`module.${M}`,async(payload)=>{
    // GM relays player messages
    if(payload.type==="sendMessage"&&game.user.isGM){
      for(const targetId of payload.targetActorIds){
        const actor=game.actors.get(targetId);
        if(!actor)continue;
        const social=loadSection(actor,F.social);
        let conv=social.conversations.find(c=>c.id===payload.convId);
        if(!conv&&payload.isGroup){
          conv=social.conversations.find(c=>c.isGroup&&c.title===payload.title&&c.participants.includes(actor.name));
          if(conv)conv.id=payload.convId;
        }
        if(!conv){
          // Create conversation on target
          conv={id:payload.convId,participants:payload.participants,title:payload.title||null,isGroup:payload.isGroup||false,messages:[],muted:false};
          social.conversations.push(conv);
        }
        conv.messages.push({...payload.message,sent:false,read:false});
        await saveSection(actor,F.social,social);
      }
      // Notify all clients to refresh
      game.socket.emit(`module.${M}`,{type:"refresh",actorIds:payload.targetActorIds,senderName:payload.senderName});
    }
    // Refresh notification for all clients
    if(payload.type==="refresh"){
      const myActor=playerActor();
      if(myActor&&payload.actorIds.includes(myActor.id)){
        scrollIcon?.updateBadge(myActor);
        scrollUI?.refresh();
        scrollIcon?.pulse();
        showToast(payload.senderName||"Someone","sent you a message");
      }
    }
  });
}

function emitMessage(convId,participants,title,isGroup,message,targetActorIds,senderName){
  game.socket.emit(`module.${M}`,{type:"sendMessage",convId,participants,title,isGroup,message,targetActorIds,senderName});
}


// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================
function showToast(title,body){
  const existing=document.getElementById("zs-toast");
  existing?.remove();
  const toast=el("div",{id:"zs-toast",html:`<div class="zst-title">${title}</div><div class="zst-body">${body}</div>`,onclick:()=>{toast.remove();const a=playerActor();if(a)scrollUI?.show(a);}});
  document.body.appendChild(toast);
  setTimeout(()=>{toast.classList.add("zst-out");setTimeout(()=>toast.remove(),400);},5000);
}


// ============================================================
//  UNREAD COUNT
// ============================================================
function totalUnread(actor){
  if(!actor)return 0;
  const social=loadSection(actor,F.social);
  let count=0;
  for(const c of social.conversations||[]){
    count+=(c.messages||[]).filter(m=>!m.read&&!m.sent).length;
  }
  return count;
}


// ============================================================
//  SCROLL ICON
// ============================================================
let scrollIcon,scrollUI,gmPanel;

class ScrollIcon{
  constructor(){this.el=null;this._dragged=false;}
  inject(){
    if(this.el)return;
    const d=el("div",{id:"zs-icon"});
    d.innerHTML=`<div class="zsi-device"><div class="zsi-shell"></div><div class="zsi-panel"></div><div class="zsi-trim"></div><div class="zsi-orb"><div class="zsi-orb-bezel"></div><div class="zsi-orb-crystal"></div></div><div class="zsi-gem zsi-gem-t"></div><div class="zsi-gem zsi-gem-b"></div><div class="zsi-gem zsi-gem-tl"></div><div class="zsi-gem zsi-gem-tr"></div><div class="zsi-gem zsi-gem-bl"></div><div class="zsi-gem zsi-gem-br"></div></div><div class="zsi-label">SCROLL</div><div class="zsi-badge" style="display:none">0</div>`;
    d.addEventListener("click",()=>{if(this._dragged)return;const a=playerActor();if(!a)return ui.notifications.warn("No character assigned.");scrollUI.toggle(a);});
    d.addEventListener("contextmenu",e=>{e.preventDefault();if(game.user.isGM)gmPanel.open();});
    let sx,sy,ox,oy;
    d.addEventListener("pointerdown",e=>{if(e.button!==0)return;this._dragged=false;sx=e.clientX;sy=e.clientY;const r=d.getBoundingClientRect();ox=e.clientX-r.left;oy=e.clientY-r.top;const mv=ev=>{if(Math.abs(ev.clientX-sx)>4||Math.abs(ev.clientY-sy)>4)this._dragged=true;if(!this._dragged)return;d.style.left=(ev.clientX-ox)+"px";d.style.top=(ev.clientY-oy)+"px";d.style.right="auto";d.style.bottom="auto";};const up=()=>{document.removeEventListener("pointermove",mv);document.removeEventListener("pointerup",up);if(this._dragged){const r2=d.getBoundingClientRect();game.user.setFlag(M,FP,{x:r2.left,y:r2.top});setTimeout(()=>this._dragged=false,60);}};document.addEventListener("pointermove",mv);document.addEventListener("pointerup",up);});
    document.body.appendChild(d);this.el=d;
    const saved=game.user.getFlag(M,FP);
    if(saved){d.style.left=saved.x+"px";d.style.top=saved.y+"px";d.style.right="auto";d.style.bottom="auto";}
  }
  pulse(){this.el?.classList.add("zs-pulse");setTimeout(()=>this.el?.classList.remove("zs-pulse"),1200);}
  badge(n){const b=this.el?.querySelector(".zsi-badge");if(!b)return;if(n>0){b.textContent=n>9?"9+":n;b.style.display="flex";}else b.style.display="none";}
  updateBadge(a){this.badge(totalUnread(a));}
}

const CORNER_SVG=`<svg viewBox="0 0 28 28" width="28" height="28"><path d="M2,2 L12,2 L12,4 L4,4 L4,12 L2,12 Z" fill="#c8a030" opacity="0.7"/><circle cx="3" cy="3" r="2" fill="#1a8050" opacity="0.9"/></svg>`;


// ============================================================
//  PLAYER UI
// ============================================================
class ScrollUI{
  constructor(){this.el=null;this.actor=null;this.tab="home";this.open_=false;this.convId=null;}
  toggle(a){if(this.open_&&this.actor?.id===a?.id)this.close();else this.show(a);}
  show(a){this.actor=a;this.tab="home";this.convId=null;this.open_=true;this.render();}
  close(){this.open_=false;if(this.el){this.el.classList.add("zs-out");setTimeout(()=>{this.el?.remove();this.el=null;},300);}}
  refresh(){if(this.open_&&this.actor)this.render();}

  render(){
    this.el?.remove();
    const data=loadAll(this.actor),marks=getMarks(this.actor);
    const root=el("div",{id:"zs-ui"});
    root.addEventListener("mousedown",e=>{if(e.target===root)this.close();});
    const frame=el("div",{class:"zsu-frame"});
    frame.appendChild(el("div",{class:"zsu-close",text:"\u00D7",onclick:()=>this.close()}));
    const body=el("div",{class:"zsu-body"});
    body.appendChild(el("div",{class:"zsu-gold-trim"}));
    for(const p of["tl","tr","bl","br"])body.appendChild(el("div",{class:`zsu-corner zsu-corner-${p}`,html:CORNER_SVG}));
    for(const p of["tl","tr","bl","br","ml","mr"])body.appendChild(el("div",{class:`zsu-gem zsu-gem-${p}`}));
    for(const s of["l","r"]){const o=el("div",{class:`zsu-orb zsu-orb-${s}`});o.innerHTML=`<div class="zsu-orb-bezel"></div><div class="zsu-orb-crystal"></div>`;body.appendChild(o);}
    const inner=el("div",{class:"zsu-inner-frame"});
    const screen=el("div",{class:"zsu-screen"});
    screen.appendChild(el("div",{class:"zsu-scanline"}));
    const content=el("div",{class:"zsu-content"});
    const ci=el("div",{class:"zsu-inner"});
    this[`_${this.tab}`](ci,data,marks);
    content.appendChild(ci);screen.appendChild(content);
    const nav=el("div",{class:"zsu-nav"});
    const unread=totalUnread(this.actor);
    for(const[t,ico] of[["home","fa-house"],["schedule","fa-calendar-days"],["gift","fa-star"],["messages","fa-comment"],["relationships","fa-heart"],["gallery","fa-image"]]){
      nav.appendChild(el("button",{class:"zsu-navbtn"+(this.tab===t?" active":""),html:`<i class="fa-solid ${ico}"></i>${t==="messages"&&unread>0?'<span class="zsu-navdot"></span>':""}`,title:t[0].toUpperCase()+t.slice(1),onclick:()=>{this.tab=t;this.convId=null;this.render();}}));}
    screen.appendChild(nav);inner.appendChild(screen);body.appendChild(inner);frame.appendChild(body);root.appendChild(frame);document.body.appendChild(root);this.el=root;
    setTimeout(()=>ci.classList.add("zsu-booted"),250);
  }

  // ---- HOME ----
  _home(ct,d,marks){
    const dismissed=d.dismissedAnnouncements||[];
    const anns=(d.announcements||[]).map((a,i)=>dismissed.includes(i)?"":`<div class="zsh-ann" data-idx="${i}"><i class="fa-solid fa-bullhorn"></i> ${a.text} <span class="zsh-antime">${a.time||""}</span><span class="zsh-ann-x" data-idx="${i}">\u00D7</span></div>`).join("");
    let evtH="";
    if(d.nextEvent){const dy=d.nextEventDays??0;evtH=`<div class="zsh-event"><div class="zsh-evlabel">NEXT EVENT</div><div class="zsh-evname">${d.nextEvent}</div><div class="zsh-evdays">${dy===0?"TODAY":dy===1?"TOMORROW":`${dy} days`}</div></div>`;}
    ct.innerHTML=`
    <div class="zsh-header"><div class="zsh-portrait"><img src="${this.actor.img}"/></div><div class="zsh-info"><div class="zsh-name">${this.actor.name}</div>${d.cohort?`<div class="zsh-cohort">${d.cohort}</div>`:""}<div class="zsh-id">${d.studentId}</div><div class="zsh-status" id="zsh-sd">${d.status?`<span class="zsh-stxt">${d.status}</span>`:`<span class="zsh-stxt zsh-stph">Tap to set status...</span>`}</div></div></div>
    ${evtH}${anns?`<div class="zsh-announce">${anns}</div>`:""}
    <div class="zsh-stats"><div class="zsh-stat"><div class="zsh-sl">YEAR</div><div class="zsh-sv">${yearLabel(d.year)}</div></div><div class="zsh-stat"><div class="zsh-sl">MARKS</div><div class="zsh-sv zsh-gold">${marks}</div></div><div class="zsh-stat"><div class="zsh-sl">GIFT</div><div class="zsh-sv zsh-sm">${d.gift||"\u2014"}</div></div></div>
    ${d.dormitory?`<div class="zsh-detail"><span class="zsh-dl">DORMITORY</span><span>${d.dormitory}</span></div>`:""}
    ${d.notes?`<div class="zsh-notes">${d.notes}</div>`:""}`;
    // Status edit
    ct.querySelector("#zsh-sd")?.addEventListener("click",()=>{
      const inp=el("input",{class:"zsh-statinput",type:"text",value:d.status||"",placeholder:"What's on your mind?",maxlength:"80"});
      ct.querySelector("#zsh-sd").replaceChildren(inp);inp.focus();
      const save=async()=>{const p=loadSection(this.actor,F.profile);p.status=inp.value.trim();await saveSection(this.actor,F.profile,p);this.render();};
      inp.addEventListener("blur",save);inp.addEventListener("keydown",e=>{if(e.key==="Enter")save();});
    });
    // Dismiss announcements
    ct.querySelectorAll(".zsh-ann-x").forEach(b=>b.addEventListener("click",async e=>{
      e.stopPropagation();if(!confirm("Dismiss this?"))return;
      const sys=loadSection(this.actor,F.system);if(!sys.dismissedAnnouncements)sys.dismissedAnnouncements=[];
      sys.dismissedAnnouncements.push(Number(b.dataset.idx));
      await saveSection(this.actor,F.system,sys);this.render();
    }));
  }

  _schedule(ct,d){
    const rows=d.schedule.filter(s=>s.course).map(s=>`<div class="zss-row"><div class="zss-period">${s.period}</div><div class="zss-info"><div class="zss-course">${s.course}</div><div class="zss-meta">${s.instructor}${s.location?" \u00B7 "+s.location:""}</div></div></div>`).join("");
    ct.innerHTML=`<div class="zs-ttl">Class Schedule</div>${rows||'<div class="zs-empty">No classes scheduled.</div>'}`;
  }

  _gift(ct,d){
    if(!d.gift){ct.innerHTML=`<div class="zs-ttl">Gift Details</div><div class="zs-empty">No Gift data.</div>`;return;}
    const ms=(d.giftMilestones||[]).map(m=>`<div class="zsg-ms ${m.achieved?"done":""}"><span class="zsg-dot">${m.achieved?"\u25C6":"\u25C7"}</span><span>${m.name}</span></div>`).join("");
    ct.innerHTML=`<div class="zs-ttl">Gift Details</div><div class="zsg-head"><div class="zsg-name">${d.gift}</div><div class="zsg-lvl">Lv${d.giftLevel||1}</div></div>${d.giftDescription?`<div class="zsg-desc">${d.giftDescription}</div>`:""}${ms?`<div class="zsg-mslabel">PROGRESSION</div>${ms}`:""}`;
  }

  // ---- MESSAGES (conversation-based) ----
  _messages(ct,d){
    if(this.convId){this._convThread(ct,d);return;}
    const social=loadSection(this.actor,F.social);
    const convs=social.conversations||[];
    ct.innerHTML=`<div class="zs-ttl">Messages</div>`;

    // New message button - always show
    ct.appendChild(el("div",{class:"zsm-pm-btn",html:'<i class="fa-solid fa-plus"></i> New Conversation',onclick:()=>this._newConvPicker(ct)}));

    if(!convs.length){ct.appendChild(el("div",{class:"zs-empty",text:"No conversations yet."}));return;}

    // Sort by last message time (most recent first)
    const sorted=[...convs].sort((a,b)=>{
      const la=a.messages?.[a.messages.length-1];
      const lb=b.messages?.[b.messages.length-1];
      return(convs.indexOf(b))-(convs.indexOf(a));
    });

    for(const conv of sorted){
      const lastMsg=conv.messages?.[conv.messages.length-1];
      if(!lastMsg&&!conv.isGroup)continue;
      const unread=conv.messages.filter(m=>!m.read&&!m.sent).length;
      // Display name: for 1-on-1, show the OTHER person. For group, show title.
      const myName=this.actor.name;
      const displayName=conv.isGroup?(conv.title||conv.participants.filter(n=>n!==myName).join(", ")):conv.participants.find(n=>n!==myName)||"Unknown";
      const portrait=findPortrait(displayName,d.relationships);
      const preview=lastMsg?(lastMsg.text?.length>50?lastMsg.text.slice(0,50)+"\u2026":lastMsg.text||""):"No messages yet";

      const row=el("div",{class:"zsm-thread",onclick:()=>{this.convId=conv.id;this.render();}});
      if(portrait)row.appendChild(el("img",{class:"zsm-tavatar",src:portrait}));
      else row.appendChild(el("div",{class:"zsm-tavatar-ph",html:conv.isGroup?'<i class="fa-solid fa-users"></i>':'<i class="fa-solid fa-user"></i>'}));
      const info=el("div",{class:"zsm-tinfo"});
      info.innerHTML=`<div class="zsm-tname">${displayName}${unread?`<span class="zsm-tunread">${unread}</span>`:""}</div><div class="zsm-tpreview">${lastMsg?.sent?"You: ":""}${preview}</div>`;
      row.appendChild(info);
      if(lastMsg?.time)row.appendChild(el("div",{class:"zsm-ttime",text:lastMsg.time}));
      ct.appendChild(row);
    }
  }

  _convThread(ct,d){
    const social=loadSection(this.actor,F.social);
    const conv=social.conversations.find(c=>c.id===this.convId);
    if(!conv){this.convId=null;this._messages(ct,d);return;}
    const myName=this.actor.name;
    const displayName=conv.isGroup?(conv.title||conv.participants.filter(n=>n!==myName).join(", ")):conv.participants.find(n=>n!==myName)||"Unknown";
    const portrait=findPortrait(displayName,d.relationships);

    // Mark all received messages as read
    let changed=false;
    for(const m of conv.messages){if(!m.read&&!m.sent){m.read=true;changed=true;}}
    if(changed)saveSection(this.actor,F.social,social).then(()=>scrollIcon?.updateBadge(this.actor));

    const wrap=el("div",{class:"zsm-thread-wrap"});
    const header=el("div",{class:"zsm-thread-header"});
    header.appendChild(el("div",{class:"zsm-back",html:'<i class="fa-solid fa-chevron-left"></i> Back',onclick:()=>{this.convId=null;this.render();}}));
    const hdr=el("div",{class:"zsm-thead"});
    if(portrait)hdr.appendChild(el("img",{class:"zsm-thimg",src:portrait}));
    hdr.appendChild(el("div",{class:"zsm-thname",text:displayName}));
    if(conv.isGroup){
      hdr.appendChild(el("div",{class:"zsm-thsub",text:conv.participants.length+" members"}));
    }
    header.appendChild(hdr);wrap.appendChild(header);

    const list=el("div",{class:"zsm-msglist"});
    for(const m of conv.messages){
      const cls=m.sent?"zsm-msg zsm-sent":"zsm-msg";
      const senderLabel=conv.isGroup&&!m.sent?`<div class="zsm-mfrom">${m.from}</div>`:"";
      const msg=el("div",{class:cls});
      msg.innerHTML=`${senderLabel}<div class="zsm-mbody">${m.text}</div>${m.image?`<img class="zsm-mimg" src="${m.image}" data-zs-lb="${m.image}"/>`:""}<div class="zsm-mtime">${m.time||""}</div>`;
      list.appendChild(msg);
    }
    wrap.appendChild(list);

    // Reply bar
    const reply=el("div",{class:"zsm-reply"});
    const inp=el("input",{class:"zsm-replyinput",type:"text",placeholder:"Type a message...",maxlength:"300"});
    const sendBtn=el("button",{class:"zsm-sendbtn",html:'<i class="fa-solid fa-paper-plane"></i>',onclick:async()=>{
      const txt=inp.value.trim();if(!txt)return;
      const ts=getAutoTime()||"Now";
      const msg={from:myName,text:txt,time:ts,image:"",read:true,sent:true};
      conv.messages.push(msg);
      await saveSection(this.actor,F.social,social);

      // Send to other participants via socket
      const otherIds=conv.participants.filter(n=>n!==myName).map(n=>game.actors.getName(n)?.id).filter(Boolean);
      if(otherIds.length){
        emitMessage(conv.id,conv.participants,conv.title,conv.isGroup,{from:myName,text:txt,time:ts,image:""},otherIds,myName);
      }
      inp.value="";this.render();
    }});
    inp.addEventListener("keydown",e=>{if(e.key==="Enter")sendBtn.click();});
    reply.append(inp,sendBtn);wrap.appendChild(reply);
    ct.appendChild(wrap);

    setTimeout(()=>list.scrollTop=list.scrollHeight,50);
    ct.querySelectorAll("[data-zs-lb]").forEach(img=>img.addEventListener("click",()=>this._lightbox(img.dataset.zsLb)));
  }

  _newConvPicker(ct){
    // Find all other player characters
    const others=game.users.filter(u=>u.character&&u.character.id!==this.actor.id);
    if(!others.length){ui.notifications.info("No other characters to message.");return;}
    const picker=el("div",{class:"zsm-picker"});
    picker.appendChild(el("div",{class:"zsm-picker-title",text:"Start conversation with:"}));
    for(const u of others){
      picker.appendChild(el("div",{class:"zsm-picker-row",onclick:async()=>{
        // Create or find existing 1-on-1 conversation
        const social=loadSection(this.actor,F.social);
        let conv=social.conversations.find(c=>!c.isGroup&&c.participants.includes(u.character.name)&&c.participants.includes(this.actor.name));
        if(!conv){
          conv={id:convId(),participants:[this.actor.name,u.character.name],title:null,isGroup:false,messages:[],muted:false};
          social.conversations.push(conv);
          await saveSection(this.actor,F.social,social);
        }
        this.convId=conv.id;this.render();
      }},[
        el("img",{class:"zsm-picker-img",src:u.character.img}),
        el("div",{class:"zsm-picker-name",text:u.character.name})
      ]));
    }
    picker.appendChild(el("div",{class:"zsm-picker-cancel",text:"Cancel",onclick:()=>picker.remove()}));
    ct.appendChild(picker);
  }

  // ---- RELATIONSHIPS (Visual Novel Style) ----
  _relationships(ct,d){
    ct.innerHTML=`<div class="zs-ttl">Contacts</div>`;
    const social=loadSection(this.actor,F.social);
    const rels=d.relationships||[];
    const others=game.users.filter(u=>!u.isGM&&u.character&&u.character.id!==this.actor?.id);

    // Build unified contact list with categories
    const cats={Cohort:[],Faculty:[],Students:[],Other:[]};

    // Add player characters as Cohort entries
    for(const u of others){
      const pd=loadSection(u.character,F.profile);
      const existing=rels.find(r=>r.name===u.character.name);
      cats.Cohort.push({
        name:u.character.name,title:existing?.title||pd.cohort||"",
        img:existing?.img||u.character.img,rank:existing?.rank??0,
        category:"Cohort",history:existing?.history||[],notes:existing?.notes||"",
        isPlayer:true,active:u.active,status:pd.status||""
      });
    }
    // Add NPC contacts, skip anyone already in Cohort
    for(const r of rels){
      if(cats.Cohort.find(c=>c.name===r.name))continue;
      const cat=r.category||"Other";
      (cats[cat]||cats.Other).push({...r,notes:r.notes||"",isPlayer:false,active:false,status:""});
    }

    let hasAny=false;
    for(const[cat,list] of Object.entries(cats)){
      if(!list.length)continue;
      hasAny=true;
      ct.appendChild(el("div",{class:"zsr-vn-cat",text:cat}));
      const grid=el("div",{class:"zsr-vn-grid"});
      for(const r of list){
        const ri=relInfo(r.rank??0);
        const portrait=r.img||resolvePortrait(r.name);
        const circle=el("div",{class:"zsr-vn-circle"});
        circle.style.setProperty("--rel-color",ri.color);
        circle.style.setProperty("--rel-glow",ri.color+"60");

        if(portrait)circle.appendChild(el("img",{class:"zsr-vn-img",src:portrait}));
        else circle.appendChild(el("div",{class:"zsr-vn-ph",html:'<i class="fa-solid fa-user"></i>'}));

        circle.appendChild(el("div",{class:"zsr-vn-cname",text:r.name.split(" ")[0]}));

        if(r.isPlayer&&r.active)circle.appendChild(el("div",{class:"zsr-vn-online"}));

        // Hover tooltip
        const tip=el("div",{class:"zsr-vn-tip"});
        tip.innerHTML=`<div class="zsr-vn-tip-name">${r.name}</div>${r.title?`<div class="zsr-vn-tip-title">${r.title}</div>`:""}<div class="zsr-vn-tip-rank" style="color:${ri.color}">${ri.label}</div>${r.isPlayer&&r.status?`<div class="zsr-vn-tip-status"><i class="fa-solid fa-comment-dots"></i> ${r.status}</div>`:""}`;
        circle.appendChild(tip);

        circle.addEventListener("click",()=>this._relDetail(ct,d,r,social));
        grid.appendChild(circle);
      }
      ct.appendChild(grid);
    }
    if(!hasAny)ct.appendChild(el("div",{class:"zs-empty",text:"No contacts yet."}));
  }

  _relDetail(ct,d,contact,social){
    const ri=relInfo(contact.rank??0);
    const portrait=contact.img||resolvePortrait(contact.name);
    ct.innerHTML="";
    const wrap=el("div",{class:"zsr-vn-detail"});

    wrap.appendChild(el("div",{class:"zsr-vn-back",html:'<i class="fa-solid fa-chevron-left"></i> Back',onclick:()=>{this.tab="relationships";this.render();}}));

    const card=el("div",{class:"zsr-vn-card"});
    const pWrap=el("div",{class:"zsr-vn-portrait"});
    pWrap.style.setProperty("--rel-color",ri.color);
    if(portrait){const img=el("img",{src:portrait});img.addEventListener("click",()=>this._lightbox(portrait));pWrap.appendChild(img);}
    else pWrap.appendChild(el("div",{class:"zsr-vn-portrait-ph",html:'<i class="fa-solid fa-user"></i>'}));
    card.appendChild(pWrap);

    const info=el("div",{class:"zsr-vn-dinfo"});
    info.appendChild(el("div",{class:"zsr-vn-dname",text:contact.name}));
    if(contact.title)info.appendChild(el("div",{class:"zsr-vn-dtitle",text:contact.title}));

    const barWrap=el("div",{class:"zsr-vn-dbar-wrap"});
    const bar=el("div",{class:"zsr-vn-dbar"});
    bar.appendChild(el("div",{class:"zsr-vn-dmarker",style:{left:`${((contact.rank+5)/10)*100}%`}}));
    barWrap.appendChild(bar);
    barWrap.appendChild(el("div",{class:"zsr-vn-drank",text:ri.label,style:{color:ri.color}}));
    info.appendChild(barWrap);

    if(contact.isPlayer&&contact.status)info.appendChild(el("div",{class:"zsr-vn-dstatus",html:`<i class="fa-solid fa-comment-dots"></i> ${contact.status}`}));
    if(contact.isPlayer){
      const onBadge=el("div",{class:"zsr-vn-donline "+(contact.active?"on":"off"),text:contact.active?"Online":"Offline"});
      info.appendChild(onBadge);
    }
    card.appendChild(info);
    wrap.appendChild(card);

    // History
    if(contact.history?.length){
      const hSec=el("div",{class:"zsr-vn-hsec"});
      hSec.appendChild(el("div",{class:"zsr-vn-slabel",text:"History"}));
      for(const h of contact.history)hSec.appendChild(el("div",{class:"zsr-vn-hentry",text:h}));
      wrap.appendChild(hSec);
    }

    // Personal notes
    const nSec=el("div",{class:"zsr-vn-nsec"});
    nSec.appendChild(el("div",{class:"zsr-vn-slabel",text:"Personal Notes"}));
    const ta=el("textarea",{class:"zsr-vn-notes",placeholder:"Write your thoughts about this person...",rows:"4"});
    ta.value=contact.notes||"";
    let saveTimer;
    ta.addEventListener("input",()=>{
      clearTimeout(saveTimer);
      saveTimer=setTimeout(async()=>{
        const fresh=loadSection(this.actor,F.social);
        let rel=fresh.relationships.find(r=>r.name===contact.name);
        if(rel){rel.notes=ta.value;}
        else{fresh.relationships.push({name:contact.name,title:contact.title||"",img:contact.img||"",rank:contact.rank??0,category:contact.category||"Other",history:[],notes:ta.value});}
        await saveSection(this.actor,F.social,fresh);
      },800);
    });
    nSec.appendChild(ta);
    nSec.appendChild(el("div",{class:"zsr-vn-nhint",text:"Auto-saved as you type."}));
    wrap.appendChild(nSec);

    ct.appendChild(wrap);
    setTimeout(()=>wrap.classList.add("zsr-vn-in"),30);
  }

  // ---- GALLERY ----
  _gallery(ct,d){
    ct.innerHTML=`<div class="zs-ttl">Gallery</div>`;
    const imgs=d.gallery||[];
    if(!imgs.length){ct.appendChild(el("div",{class:"zs-empty",text:"No images."}));return;}
    const grid=el("div",{class:"zsx-grid"});
    for(const g of imgs){
      const item=el("div",{class:"zsx-item"});
      const img=el("img",{src:g.src,alt:g.caption||"",title:g.caption||""});
      img.addEventListener("click",()=>this._lightbox(g.src,g.caption));
      item.appendChild(img);
      if(g.caption)item.appendChild(el("div",{class:"zsx-cap",text:g.caption}));
      grid.appendChild(item);
    }
    ct.appendChild(grid);
  }

  _lightbox(src,caption){
    const lb=el("div",{id:"zs-lightbox",onclick:e=>{if(e.target.id==="zs-lightbox"||e.target.classList.contains("zslb-close"))lb.remove();}});
    lb.innerHTML=`<div class="zslb-wrap"><div class="zslb-close">\u00D7</div><img class="zslb-img" src="${src}"/>${caption?`<div class="zslb-cap">${caption}</div>`:""}</div>`;
    document.body.appendChild(lb);
  }
}


// ============================================================
//  GM COMMAND CENTER
// ============================================================
class GMPanel{
  constructor(){this.el=null;this.actor=null;this.section="info";}
  open(actor){if(!game.user.isGM)return;this.actor=actor??game.users.find(u=>!u.isGM&&u.character)?.character??null;this.section="info";this.render();}
  close(){this.el?.remove();this.el=null;}

  render(){
    this.el?.remove();if(!this.actor){ui.notifications.warn("No actor.");return;}
    const root=el("div",{id:"zs-gm"});root.addEventListener("mousedown",e=>{if(e.target===root)this.close();});
    const panel=el("div",{class:"zg-panel"});

    // Header with actor picker
    const hdr=el("div",{class:"zg-header"});
    hdr.appendChild(el("div",{class:"zg-title",text:"Command Center"}));
    const sel=el("select",{class:"zg-actsel"});
    for(const a of game.actors){const o=el("option",{value:a.id,text:a.name});if(a.id===this.actor.id)o.selected=true;sel.appendChild(o);}
    sel.addEventListener("change",()=>{this.actor=game.actors.get(sel.value);this.render();});
    hdr.appendChild(sel);
    hdr.appendChild(el("div",{class:"zg-close",text:"\u00D7",onclick:()=>this.close()}));
    panel.appendChild(hdr);

    // Tabs
    const tabs=el("div",{class:"zg-tabs"});
    for(const[k,l] of[["info","Info"],["schedule","Schedule"],["gift","Gift"],["messages","Messages"],["relationships","Rels"],["gallery","Gallery"],["announce","Announce"],["event","Event"]]){
      tabs.appendChild(el("button",{class:"zg-tab"+(this.section===k?" active":""),text:l,onclick:()=>{this.section=k;this.render();}}));
    }
    panel.appendChild(tabs);

    const body=el("div",{class:"zg-body"});
    this[`_gm_${this.section}`](body);
    panel.appendChild(body);
    root.appendChild(panel);document.body.appendChild(root);this.el=root;
  }

  // Helpers
  _inp(p,lbl,val,at={}){const r=el("div",{class:"zg-row"});r.appendChild(el("label",{text:lbl}));const i=el("input",{type:"text",value:val??"",...at});r.appendChild(i);p.appendChild(r);return i;}
  _sel(p,lbl,val,opts){const r=el("div",{class:"zg-row"});r.appendChild(el("label",{text:lbl}));const s=el("select");for(const[v,t] of opts){const o=el("option",{value:v,text:t});if(String(v)===String(val))o.selected=true;s.appendChild(o);}r.appendChild(s);p.appendChild(r);return s;}
  _ta(p,lbl,val){const r=el("div",{class:"zg-row"});r.appendChild(el("label",{text:lbl}));const t=el("textarea",{rows:"3"});t.value=val??"";r.appendChild(t);p.appendChild(r);return t;}
  _save(p,fn){p.appendChild(el("button",{class:"zg-save",html:'<i class="fa-solid fa-save"></i> Save',onclick:fn}));}

  // ---- INFO ----
  _gm_info(body){
    const d=loadSection(this.actor,F.profile);
    const ac=loadSection(this.actor,F.academic);
    const id=this._inp(body,"Student ID",d.studentId),yr=this._sel(body,"Year",d.year,[["1","First"],["2","Second"],["3","Third"],["4","Fourth"]]),co=this._inp(body,"Cohort",d.cohort),dm=this._inp(body,"Dormitory",d.dormitory);
    const nt=this._ta(body,"Notes (HTML ok)",ac.notes);
    body.appendChild(el("div",{class:"zg-hint",text:`Status: "${d.status||"(none)"}" | Marks: ${getMarks(this.actor)}`}));
    this._save(body,async()=>{
      const freshP=loadSection(this.actor,F.profile);freshP.studentId=id.value;freshP.year=Number(yr.value);freshP.cohort=co.value;freshP.dormitory=dm.value;await saveSection(this.actor,F.profile,freshP);
      const freshA=loadSection(this.actor,F.academic);freshA.notes=nt.value;await saveSection(this.actor,F.academic,freshA);
      ui.notifications.info("Saved.");scrollUI.refresh();scrollIcon.pulse();
    });
    // Copy to all
    body.appendChild(el("div",{class:"zg-divider"}));
    body.appendChild(el("button",{class:"zg-add",text:"Copy Year + Cohort to All Students",onclick:async()=>{
      for(const u of game.users.filter(u=>!u.isGM&&u.character)){
        const p=loadSection(u.character,F.profile);p.year=Number(yr.value);p.cohort=co.value;await saveSection(u.character,F.profile,p);
      }ui.notifications.info("Copied.");
    }}));
  }

  // ---- SCHEDULE ----
  _gm_schedule(body){
    const d=loadSection(this.actor,F.academic);
    const rows=[...d.schedule],ct=el("div",{class:"zg-arr"});
    const draw=()=>{ct.innerHTML="";rows.forEach((s,i)=>{const r=el("div",{class:"zg-arow"});const pI=el("input",{value:s.period,placeholder:"Period",style:{maxWidth:"100px"}});const cI=el("input",{value:s.course,placeholder:"Course"});const iI=el("input",{value:s.instructor,placeholder:"Instructor"});const lI=el("input",{value:s.location,placeholder:"Location"});pI.oninput=()=>rows[i].period=pI.value;cI.oninput=()=>rows[i].course=cI.value;iI.oninput=()=>rows[i].instructor=iI.value;lI.oninput=()=>rows[i].location=lI.value;r.append(pI,cI,iI,lI,el("button",{class:"zg-rm",html:'<i class="fa-solid fa-xmark"></i>',onclick:()=>{rows.splice(i,1);draw();}}));ct.appendChild(r);});};
    draw();body.appendChild(ct);
    body.appendChild(el("button",{class:"zg-add",html:'<i class="fa-solid fa-plus"></i> Add Period',onclick:()=>{rows.push({period:"",course:"",instructor:"",location:""});draw();}}));
    this._save(body,async()=>{const fresh=loadSection(this.actor,F.academic);fresh.schedule=rows;await saveSection(this.actor,F.academic,fresh);ui.notifications.info("Saved.");scrollUI.refresh();});
    body.appendChild(el("div",{class:"zg-divider"}));
    body.appendChild(el("button",{class:"zg-add",text:"Copy Schedule to All Students",onclick:async()=>{
      for(const u of game.users.filter(u=>!u.isGM&&u.character)){const a=loadSection(u.character,F.academic);a.schedule=[...rows];await saveSection(u.character,F.academic,a);}ui.notifications.info("Copied.");
    }}));
  }

  // ---- GIFT ----
  _gm_gift(body){
    const d=loadSection(this.actor,F.academic);
    const gI=this._inp(body,"Gift",d.gift),lI=this._inp(body,"Level",d.giftLevel,{type:"number",min:"1",max:"20"}),dT=this._ta(body,"Description",d.giftDescription);
    const ms=[...(d.giftMilestones||[])];body.appendChild(el("label",{text:"Milestones",class:"zg-sub"}));
    const mC=el("div",{class:"zg-arr"});
    const drawM=()=>{mC.innerHTML="";ms.forEach((m,i)=>{const r=el("div",{class:"zg-arow"});const n=el("input",{value:m.name,placeholder:"Milestone"});n.oninput=()=>ms[i].name=n.value;r.append(n,el("button",{class:"zg-tog",text:m.achieved?"\u25C6":"\u25C7",style:{color:m.achieved?"#d4940a":"#608080"},onclick:()=>{ms[i].achieved=!ms[i].achieved;drawM();}}),el("button",{class:"zg-rm",html:'<i class="fa-solid fa-xmark"></i>',onclick:()=>{ms.splice(i,1);drawM();}}));mC.appendChild(r);});};
    drawM();body.appendChild(mC);
    body.appendChild(el("button",{class:"zg-add",html:'<i class="fa-solid fa-plus"></i> Add Milestone',onclick:()=>{ms.push({name:"",achieved:false});drawM();}}));
    this._save(body,async()=>{const fresh=loadSection(this.actor,F.academic);fresh.gift=gI.value;fresh.giftLevel=Number(lI.value)||1;fresh.giftDescription=dT.value;fresh.giftMilestones=ms;await saveSection(this.actor,F.academic,fresh);ui.notifications.info("Saved.");scrollUI.refresh();});
  }

  // ---- MESSAGES (GM send) ----
  _gm_messages(body){
    body.appendChild(el("div",{class:"zg-sub",text:"Send NPC Message"}));
    const sI=this._inp(body,"From (NPC name)","");
    const tI=this._inp(body,"Time","");
    const xT=this._ta(body,"Message","");
    const iI=this._inp(body,"Image path (optional)","");
    body.appendChild(el("button",{class:"zg-send",html:'<i class="fa-solid fa-paper-plane"></i> Send',onclick:async()=>{
      const msgText=xT.value;const senderName=sI.value;
      if(!msgText||!senderName)return ui.notifications.warn("Need sender and message.");
      const npcName=senderName.trim();
      // Re-read social data fresh at send time
      const social=loadSection(this.actor,F.social);
      let conv=social.conversations.find(c=>!c.isGroup&&c.participants.includes(npcName)&&c.participants.includes(this.actor.name));
      if(!conv){conv={id:convId(),participants:[this.actor.name,npcName],title:null,isGroup:false,messages:[],muted:false};social.conversations.push(conv);}
      conv.messages.push({from:npcName,text:msgText,time:tI.value||"",image:iI.value||"",read:false,sent:false});
      await saveSection(this.actor,F.social,social);
      ui.notifications.info(`Message from ${npcName} sent.`);scrollUI?.refresh();scrollIcon?.pulse();scrollIcon?.updateBadge(this.actor);
      sI.value="";tI.value="";xT.value="";iI.value="";
    }}));

    // Create group chat
    body.appendChild(el("div",{class:"zg-divider"}));
    body.appendChild(el("div",{class:"zg-sub",text:"Create Group Chat"}));
    const groupName=this._inp(body,"Group Name","",{placeholder:"e.g. Cohort Aurum"});
    body.appendChild(el("div",{class:"zg-hint",text:"Will add all player characters as members."}));
    body.appendChild(el("button",{class:"zg-add",text:"Create Group",onclick:async()=>{
      const name=groupName.value.trim();if(!name)return;
      const players=game.users.filter(u=>!u.isGM&&u.character);
      const participants=players.map(u=>u.character.name);
      const cid=convId();
      const seedMsg={from:"Scroll",text:`${name} group created.`,time:getAutoTime()||"",image:"",read:true,sent:false};
      for(const u of players){
        const s=loadSection(u.character,F.social);
        if(s.conversations.find(c=>c.isGroup&&c.title===name))continue;
        s.conversations.push({id:cid,participants,title:name,isGroup:true,messages:[seedMsg],muted:false});
        await saveSection(u.character,F.social,s);
      }
      ui.notifications.info(`Group "${name}" created.`);groupName.value="";
    }}));

    // View existing conversations
    body.appendChild(el("div",{class:"zg-divider"}));
    const socialView=loadSection(this.actor,F.social);
    body.appendChild(el("div",{class:"zg-sub",text:`Conversations (${socialView.conversations.length})`}));
    for(const c of socialView.conversations){
      const label=c.isGroup?`[Group] ${c.title||c.participants.join(", ")}`:c.participants.find(n=>n!==this.actor.name)||"Unknown";
      body.appendChild(el("div",{class:"zg-hint",text:`${label} (${c.messages.length} msgs)`}));
    }
  }

  // ---- RELATIONSHIPS ----
  _gm_relationships(body){
    const social=loadSection(this.actor,F.social);
    const rels=[...(social.relationships||[])];
    const ct=el("div",{class:"zg-arr"});
    const relOpts=REL_SCALE.map(r=>[String(r.val),`${r.val>0?"+":""}${r.val} ${r.label}`]);
    const catOpts=[["Faculty","Faculty"],["Students","Students"],["Other","Other"]];
    const draw=()=>{ct.innerHTML="";rels.forEach((r,i)=>{const row=el("div",{class:"zg-arow zg-arow-wrap"});
      const n=el("input",{value:r.name,placeholder:"Name"});n.oninput=()=>rels[i].name=n.value;
      const t=el("input",{value:r.title||"",placeholder:"Title"});t.oninput=()=>rels[i].title=t.value;
      const im=el("input",{value:r.img||"",placeholder:"Portrait"});im.oninput=()=>rels[i].img=im.value;
      const rS=el("select");for(const[v,tx] of relOpts){const o=el("option",{value:v,text:tx});if(Number(v)===(r.rank??0))o.selected=true;rS.appendChild(o);}rS.onchange=()=>rels[i].rank=Number(rS.value);
      const cS=el("select");for(const[v,tx] of catOpts){const o=el("option",{value:v,text:tx});if(v===(r.category||"Other"))o.selected=true;cS.appendChild(o);}cS.onchange=()=>rels[i].category=cS.value;
      row.append(n,t,im,rS,cS,el("button",{class:"zg-rm",html:'<i class="fa-solid fa-xmark"></i>',onclick:()=>{rels.splice(i,1);draw();}}));ct.appendChild(row);});};
    draw();body.appendChild(ct);

    // Quick add from actors
    const addSel=el("select",{class:"zg-actsel"});
    addSel.appendChild(el("option",{value:"",text:"-- Quick add actor --"}));
    for(const a of game.actors){if(rels.find(r=>r.name===a.name))continue;addSel.appendChild(el("option",{value:a.id,text:a.name}));}
    addSel.addEventListener("change",()=>{if(!addSel.value)return;const a=game.actors.get(addSel.value);rels.push({name:a.name,title:"",img:a.img,rank:0,category:"Other",history:[]});draw();addSel.value="";});
    body.appendChild(addSel);

    body.appendChild(el("button",{class:"zg-add",html:'<i class="fa-solid fa-plus"></i> Add Manually',onclick:()=>{rels.push({name:"",title:"",img:"",rank:0,category:"Other",history:[]});draw();}}));
    this._save(body,async()=>{const fresh=loadSection(this.actor,F.social);fresh.relationships=rels;await saveSection(this.actor,F.social,fresh);ui.notifications.info("Saved.");scrollUI.refresh();});

    body.appendChild(el("div",{class:"zg-divider"}));
    body.appendChild(el("button",{class:"zg-add",text:"Copy All Contacts to All Students",onclick:async()=>{
      for(const u of game.users.filter(u=>!u.isGM&&u.character)){
        const s=loadSection(u.character,F.social);
        for(const r of rels){if(!s.relationships.find(x=>x.name===r.name))s.relationships.push(JSON.parse(JSON.stringify(r)));}
        await saveSection(u.character,F.social,s);
      }ui.notifications.info("Contacts copied.");
    }}));
  }

  // ---- GALLERY ----
  _gm_gallery(body){
    const d=loadSection(this.actor,F.media);
    const imgs=[...(d.gallery||[])];const ct=el("div",{class:"zg-arr"});
    const draw=()=>{ct.innerHTML="";imgs.forEach((g,i)=>{const r=el("div",{class:"zg-arow"});const s=el("input",{value:g.src,placeholder:"Image path"});s.oninput=()=>imgs[i].src=s.value;const c=el("input",{value:g.caption||"",placeholder:"Caption"});c.oninput=()=>imgs[i].caption=c.value;r.append(s,c,el("button",{class:"zg-rm",html:'<i class="fa-solid fa-xmark"></i>',onclick:()=>{imgs.splice(i,1);draw();}}));ct.appendChild(r);});};
    draw();body.appendChild(ct);
    body.appendChild(el("button",{class:"zg-add",html:'<i class="fa-solid fa-plus"></i> Add Image',onclick:()=>{imgs.push({src:"",caption:""});draw();}}));
    let folderHint="scroll-gallery";try{folderHint=game.settings.get(M,"galleryFolder");}catch(e){}
    body.appendChild(el("div",{class:"zg-hint",text:`Gallery folder: "${folderHint}"`}));
    this._save(body,async()=>{const fresh=loadSection(this.actor,F.media);fresh.gallery=imgs;await saveSection(this.actor,F.media,fresh);ui.notifications.info("Saved.");scrollUI.refresh();});
  }

  // ---- ANNOUNCEMENTS ----
  _gm_announce(body){
    const d=loadSection(this.actor,F.system);
    const anns=[...(d.announcements||[])];const ct=el("div",{class:"zg-arr"});
    const draw=()=>{ct.innerHTML="";anns.forEach((a,i)=>{const r=el("div",{class:"zg-arow"});const t=el("input",{value:a.text,placeholder:"Text"});t.oninput=()=>anns[i].text=t.value;const tm=el("input",{value:a.time||"",placeholder:"Time",style:{maxWidth:"120px"}});tm.oninput=()=>anns[i].time=tm.value;r.append(t,tm,el("button",{class:"zg-rm",html:'<i class="fa-solid fa-xmark"></i>',onclick:()=>{anns.splice(i,1);draw();}}));ct.appendChild(r);});};
    draw();body.appendChild(ct);
    body.appendChild(el("button",{class:"zg-add",html:'<i class="fa-solid fa-plus"></i> Add',onclick:()=>{anns.push({text:"",time:""});draw();}}));
    this._save(body,async()=>{const fresh=loadSection(this.actor,F.system);fresh.announcements=anns;await saveSection(this.actor,F.system,fresh);ui.notifications.info("Saved.");scrollUI.refresh();scrollIcon.pulse();});
    body.appendChild(el("div",{class:"zg-divider"}));
    body.appendChild(el("button",{class:"zg-add",text:"Push Announcements to All Students",onclick:async()=>{
      for(const u of game.users.filter(u=>!u.isGM&&u.character)){const s=loadSection(u.character,F.system);s.announcements=[...anns];s.dismissedAnnouncements=[];await saveSection(u.character,F.system,s);}ui.notifications.info("Pushed.");
    }}));
  }

  // ---- EVENT ----
  _gm_event(body){
    const d=loadSection(this.actor,F.academic);
    const ev=this._inp(body,"Event Name",d.nextEvent,{placeholder:"e.g. Second Examination"});
    const dy=this._inp(body,"Days Until",d.nextEventDays,{type:"number",min:"0"});
    body.appendChild(el("div",{class:"zg-hint",text:"0 = TODAY. Blank name hides it."}));
    this._save(body,async()=>{const fresh=loadSection(this.actor,F.academic);fresh.nextEvent=ev.value;fresh.nextEventDays=Number(dy.value)||0;await saveSection(this.actor,F.academic,fresh);ui.notifications.info("Saved.");scrollUI.refresh();});
    body.appendChild(el("div",{class:"zg-divider"}));
    body.appendChild(el("button",{class:"zg-add",text:"Set Event for All Students",onclick:async()=>{
      for(const u of game.users.filter(u=>!u.isGM&&u.character)){const a=loadSection(u.character,F.academic);a.nextEvent=ev.value;a.nextEventDays=Number(dy.value)||0;await saveSection(u.character,F.academic,a);}ui.notifications.info("Set for all.");
    }}));
  }
}


// ============================================================
//  MACRO API
// ============================================================
class ZenithAPI{
  static async sendNPCMessage(actorNameOrId,npcName,text,time="",image=""){
    const a=game.actors.get(actorNameOrId)??game.actors.getName(actorNameOrId);if(!a)return ui.notifications.error("Actor not found.");
    const social=loadSection(a,F.social);
    let conv=social.conversations.find(c=>!c.isGroup&&c.participants.includes(npcName));
    if(!conv){conv={id:convId(),participants:[a.name,npcName],title:null,isGroup:false,messages:[],muted:false};social.conversations.push(conv);}
    conv.messages.push({from:npcName,text,time,image,read:false,sent:false});
    await saveSection(a,F.social,social);scrollIcon?.pulse();scrollIcon?.updateBadge(a);scrollUI?.refresh();
  }
  static async sendNPCMessageAll(npcName,text,time="",image=""){
    for(const u of game.users.filter(u=>!u.isGM&&u.character))await ZenithAPI.sendNPCMessage(u.character.id,npcName,text,time,image);
  }
  static async adjustRelationship(actorNameOrId,npcName,delta=1,reason=""){
    const a=game.actors.get(actorNameOrId)??game.actors.getName(actorNameOrId);if(!a)return;
    const social=loadSection(a,F.social);
    const r=social.relationships.find(x=>x.name===npcName);if(!r)return;
    const oldRank=r.rank??0;
    r.rank=Math.max(-5,Math.min(5,oldRank+delta));
    if(!r.history)r.history=[];
    if(reason)r.history.push(`${relInfo(oldRank).label} \u2192 ${relInfo(r.rank).label}: ${reason}`);
    await saveSection(a,F.social,social);scrollUI?.refresh();
  }
  static async addGalleryImage(actorNameOrId,src,caption=""){
    const a=game.actors.get(actorNameOrId)??game.actors.getName(actorNameOrId);if(!a)return;
    const media=loadSection(a,F.media);media.gallery.push({src,caption});
    await saveSection(a,F.media,media);scrollIcon?.pulse();scrollUI?.refresh();
  }
  static async setEvent(actorNameOrId,name,days){
    const a=game.actors.get(actorNameOrId)??game.actors.getName(actorNameOrId);if(!a)return;
    const ac=loadSection(a,F.academic);ac.nextEvent=name;ac.nextEventDays=days;
    await saveSection(a,F.academic,ac);scrollUI?.refresh();
  }
  static async setEventAll(name,days){for(const u of game.users.filter(u=>!u.isGM&&u.character))await ZenithAPI.setEvent(u.character.id,name,days);}
}


// ============================================================
//  HOOKS
// ============================================================
Hooks.once("init",()=>registerSettings());

Hooks.once("ready",async()=>{
  // Migrate all actors from old format
  for(const a of game.actors)await migrateIfNeeded(a);

  scrollIcon=new ScrollIcon();scrollIcon.inject();
  scrollUI=new ScrollUI();
  gmPanel=new GMPanel();
  initSocket();
  const mod=game.modules.get(M);if(mod)mod.api=ZenithAPI;
  const pc=playerActor();if(pc)scrollIcon.updateBadge(pc);
  console.log(`${M} | Zenith Academy Scroll v1.5 ready`);
});

Hooks.on("updateActor",(a)=>{
  if(scrollUI?.actor?.id===a.id)scrollUI.refresh();
  scrollIcon?.updateBadge(playerActor());
});
Hooks.on("updateItem",i=>{if(i.name?.toLowerCase()==="marks"&&scrollUI?.actor?.id===i.actor?.id)scrollUI.refresh();});
Hooks.on("createItem",i=>{if(i.name?.toLowerCase()==="marks"&&scrollUI?.actor?.id===i.actor?.id)scrollUI.refresh();});
Hooks.on("deleteItem",i=>{if(i.name?.toLowerCase()==="marks"&&scrollUI?.actor?.id===i.actor?.id)scrollUI.refresh();});

// Context menus
Hooks.on("getActorDirectoryEntryContext",(html,opts)=>{
  opts.push({name:"Open in Scroll Command Center",icon:'<i class="fa-solid fa-scroll"></i>',condition:()=>game.user.isGM,callback:li=>{const id=li[0]?.dataset?.documentId??li?.dataset?.documentId;const a=game.actors.get(id);if(a)gmPanel.open(a);}});
  opts.push({name:"Add as Contact to All Students",icon:'<i class="fa-solid fa-user-plus"></i>',condition:()=>game.user.isGM,callback:async li=>{
    const id=li[0]?.dataset?.documentId??li?.dataset?.documentId;
    const actor=game.actors.get(id);if(!actor)return;
    for(const u of game.users.filter(u=>!u.isGM&&u.character)){
      const s=loadSection(u.character,F.social);
      if(s.relationships.find(r=>r.name===actor.name))continue;
      s.relationships.push({name:actor.name,title:"",img:actor.img,rank:0,category:"Other",history:[]});
      await saveSection(u.character,F.social,s);
    }
    ui.notifications.info(`${actor.name} added as contact.`);scrollUI?.refresh();
  }});
});
