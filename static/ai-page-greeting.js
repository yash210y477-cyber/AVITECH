(function(){
const messages={
 index:['Welcome to AVITECH. Let’s turn your curiosity into real skills. Pick a path and I’ll guide you through it.'],
 learning:['Welcome to the learning hub. Choose IT or Aviation to begin.','Your next challenge is just one click away.'],
 it:['Great choice — IT starts here. Explore a technology and test your knowledge.','I’ll be here to guide you along the way.'],
 aviation:['Ready for takeoff? Explore aviation and build your industry knowledge.','Choose a topic and let’s get started.'],
 instructions:['Before you begin, take a moment to understand the test rules.','Once you’re ready, I’ll guide you through the assessment.'],
 quiz:['Your assessment is live. Stay focused and trust what you know. I’ll guide you through each question.'],
 theory:['Theory mode is ready. Think clearly and explain your answer in your own words.','Take your time — quality matters more than speed.'],
 result:['Here’s your performance report. Review your strengths and keep improving.','Every attempt is a step forward.'],
 progress:['Welcome to your progress dashboard. Track your growth and keep pushing forward.','Consistency is how strong skills are built.']
};

const key=location.pathname.includes('quiz')?'quiz':
location.pathname.includes('theory')?'theory':
location.pathname.includes('result')?'result':
location.pathname.includes('progress')?'progress':
location.pathname.includes('instructions')?'instructions':
location.pathname.includes('aviation')?'aviation':
location.pathname.includes('it-topic')?'it':
location.pathname.includes('it')?'it':
location.pathname.includes('learning')?'learning':'index';

const m=messages[key]||messages.index;
const greeting=m.filter(v=>typeof v==='string' && v.trim()).join(' ');
let hasSpoken=false;
let speaking=false;

function speak(done){
  // On the assessment page, the question reader owns speech output. The generic
  // greeting must not cancel or overlap the question voice (especially on iOS).
  if(key==='quiz'){
    hasSpoken=true;
    document.documentElement.dataset.avitechGreetingReady='1';
    window.dispatchEvent(new CustomEvent('avitech-greeting-done'));
    if(typeof done==='function') done();
    return;
  }
  if(hasSpoken){
    if(typeof done==='function') done();
    return;
  }
  hasSpoken=true;

  if(!('speechSynthesis' in window)){
    document.documentElement.dataset.avitechGreetingReady='1';
    window.dispatchEvent(new CustomEvent('avitech-greeting-done'));
    if(typeof done==='function') done();
    return;
  }

  try{
    speaking=true;
    speechSynthesis.cancel();

    const u=new SpeechSynthesisUtterance(greeting);
    u.lang='en-IN';
    u.rate=.92;
    u.pitch=1.02;
    u.volume=1;

    const finish=()=>{
      if(!speaking)return;
      speaking=false;
      document.documentElement.dataset.avitechGreetingReady='1';
      window.dispatchEvent(new CustomEvent('avitech-greeting-done'));
      if(typeof done==='function') done();
    };

    u.onend=finish;
    u.onerror=finish;
    speechSynthesis.speak(u);
  }catch(e){
    speaking=false;
    document.documentElement.dataset.avitechGreetingReady='1';
    window.dispatchEvent(new CustomEvent('avitech-greeting-done'));
    if(typeof done==='function') done();
  }
}

function mount(){
  if(document.querySelector('.ai-page-greeting'))return;

  const el=document.createElement('div');
  el.className='ai-page-greeting';
  el.innerHTML='<button class="ai-bubble" aria-label="AI Coach">✦</button><div class="ai-copy"><strong>AVITECH AI</strong>'+greeting+'</div><button class="ai-close" aria-label="Close">×</button>';
  document.body.appendChild(el);

  el.querySelector('.ai-bubble').addEventListener('click',()=>speak());
  el.querySelector('.ai-close').addEventListener('click',()=>el.remove());

  setTimeout(()=>speak(),500);

  // Keep the written AI greeting visible for only 5 seconds.
  // The voice can continue independently; only the on-screen bubble disappears.
  setTimeout(()=>{
    if(el && el.isConnected){
      el.classList.add('ai-greeting-hide');
      setTimeout(()=>{ if(el && el.isConnected) el.remove(); }, 260);
    }
  },5000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);
else mount();
})();
