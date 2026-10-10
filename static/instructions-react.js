(function(){
  const e=React.createElement;
  function Visual(){
    return e('div',{className:'visual','aria-label':'Animated IT and aviation visual'},
      e('div',{className:'visual-glow'}),e('div',{className:'orbit one'}),e('div',{className:'orbit two'}),
      e('span',{className:'orbit-dot dot-one'}),e('span',{className:'orbit-dot dot-two'}),
      e('div',{className:'visual-card it'},e('img',{src:'/static/images/Coding Slide.svg',alt:'IT technology'}),e('span',null,'IT / TECH',e('b',null,'01'))),
      e('div',{className:'visual-card av'},e('img',{src:'/static/images/Isometric plane.svg',alt:'Aviation aircraft'}),e('span',null,'AVIATION',e('b',null,'02'))),
      e('div',{className:'core'},e('div',{className:'core-mark'},'A'),e('div',{className:'core-label'},'LEARN • PRACTICE • TEST'))
    );
  }
  const RuleCard=({icon,title,label,children,delay})=>e('article',{className:'instruction-card',style:{animationDelay:delay||'0s'}},
    e('div',{className:'card-head'},e('div',{className:'card-icon'},icon),e('div',null,e('h3',null,title),e('span',null,label))),children);
  function App(){
    return e('main',{className:'instructions-page'},
      e('section',{className:'hero-panel'},
        e('div',{className:'hero-copy'},
          e('div',{className:'eyebrow'},e('i'), ' AVITECH • TEST BRIEFING'),
          e('h1',null,'Quiz Instructions'),
          e('p',null,'Please review the following requirements before starting. The assessment is timed and uses limited lifelines and active camera and microphone proctoring.'),
          e('div',{className:'hero-points'},
            e('span',{className:'hero-point'},'15 Questions'),
            e('span',{className:'hero-point'},'60 sec / question'),
            e('span',{className:'hero-point'},'3 Lifelines'),
            e('span',{className:'hero-point'},'Camera + Mic Required')
          )
        ),e(Visual)
      ),
      e('div',{className:'section-head'},e('h2',null,'Know the rules'),e('p',null,'The information below reflects the current AVITECH assessment and proctoring requirements.')),
      e('section',{className:'instruction-grid'},
        e(RuleCard,{icon:'📋',title:'Quiz Format',label:'Assessment format',delay:'.05s'},e('ul',{className:'rules'},
          e('li',null,'The assessment consists of ',e('span',{className:'strong'},'15 questions'),'.'),
          e('li',null,'Each question has a ',e('span',{className:'strong'},'60-second'), ' time limit.'),
          e('li',null,'Select your answer and use ',e('span',{className:'strong'},'Submit Answer'), ' to submit your response.'),
          e('li',null,'After the final question, the assessment is completed and your result is recorded.')
        )),
        e(RuleCard,{icon:'🎙️',title:'Camera & Microphone',label:'Required before the assessment',delay:'.1s'},e('ul',{className:'rules'},
          e('li',null,'Both ',e('span',{className:'strong'},'Camera and Microphone permission'), ' are required before the test can start.'),
          e('li',null,'Camera access is used for identity, attention and prohibited-object monitoring during the assessment.'),
          e('li',null,'Microphone access is used for voice monitoring and the optional voice-answer feature.'),
          e('li',null,'The assessment cannot begin unless both permissions are granted.')
        )),
        e(RuleCard,{icon:'🛟',title:'Lifelines',label:'Available during the assessment',delay:'.15s'},e('div',{className:'lifelines'},
          e('div',{className:'life'},e('div',{className:'life-badge'},'50–50'),e('strong',null,'50-50'),e('small',null,'Removes two incorrect options and may be used once during the assessment.')),
          e('div',{className:'life'},e('div',{className:'life-badge'},'↻'),e('strong',null,'Change Question'),e('small',null,'Replaces the current question with an unused question and may be used once during the assessment.')),
          e('div',{className:'life'},e('div',{className:'life-badge'},'↪'),e('strong',null,'Skip'),e('small',null,'You may manually skip up to three questions. The fourth skip incident ends the assessment.') )
        )),
        e(RuleCard,{icon:'⏭️',title:'Skip & Timer Rules',label:'Timing and skip requirements',delay:'.2s'},e('ul',{className:'rules'},
          e('li',null,'Manual Skip may be used a maximum of ',e('span',{className:'strong'},'3 times'),'.'),
          e('li',null,'A skipped question is recorded as skipped and does not receive credit.'),
          e('li',null,'If the 60-second limit expires, the current question is automatically recorded as skipped.'),
          e('li',null,'If a timeout results in the ',e('span',{className:'strong'},'4th skip incident'), ', the assessment ends automatically.'),
          e('li',null,'The Skip control is disabled after three manual skips.')
        )),
        e(RuleCard,{icon:'🛡️',title:'Proctoring Rules',label:'Prohibited activity and enforcement',delay:'.25s'},e('ul',{className:'rules'},
          e('li',null,'Candidates must remain on the assessment window throughout the test. Switching tabs or windows is not permitted.'),
          e('li',null,'Repeated loss of window focus may result in assessment termination.'),
          e('li',null,'Repeated instances of looking away from the assessment may result in termination.'),
          e('li',null,'Only the registered candidate may be visible in the camera frame; multiple faces result in immediate termination.'),
          e('li',null,'Mobile phones, books, notes or other study materials detected in view may result in termination.'),
          e('li',null,"No other person's voice or conversation is permitted during the assessment.")
        )),
        e(RuleCard,{icon:'⚠️',title:'Before You Start',label:'Before starting',delay:'.3s'},e('ul',{className:'rules'},
          e('li',null,'Grant camera and microphone access when prompted before the assessment begins.'),
          e('li',null,'Remain the only person visible in the camera frame throughout the assessment.'),
          e('li',null,'Keep mobile phones, books, notes and other study materials outside the camera view.'),
          e('li',null,'Do not switch tabs or windows while the assessment is in progress.'),
          e('li',null,'Use limited-use lifelines carefully, as each available use is consumed when activated.')
        ))
      ),
      e('section',{className:'bottom-bar'},e('div',{className:'ready'},e('div',{className:'ready-icon'},'🚀'),e('div',null,e('b',null,'Ready to begin?'),e('span',null,'Review these requirements, accept the instructions and begin the AVITECH assessment.'))),e('button',{className:'start-btn',onClick:()=>{window.location.href='/accept'}},'I Accept & Start Quiz  →'))
    );
  }
  function mount(){const root=document.getElementById('instructions-root');if(root&&window.React&&window.ReactDOM){ReactDOM.createRoot(root).render(e(App));}}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
