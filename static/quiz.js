
let lifelinesLockedAfterSubmit = false;
function escapeHtml(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
const banks={it:'/static/data/It_mcq_questions.json',aviation:'/static/data/aviation_mcq_questions.json'};
let bank='it',qs=[],questionPool=[],cur=0,selected=null,t=60,tid,answers=[];
let attemptId=null;
let testStartedAt=null;
window.quizFinished=false;
let fiftyUsed=false,skipCount=0,changeUsed=false,submitted=false,recognition=null,listening=false;
// 50-50 is one-time per test. If used on a question, the other two lifelines
// are disabled only for that particular question. They return on the next question.
let fiftyQuestionLock=false;
const $=id=>document.getElementById(id);

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    let j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function waitForAvitechGreeting(){
  return new Promise(resolve=>{
    if(document.documentElement.dataset.avitechGreetingReady==='1'){ resolve(); return; }
    let done=false;
    const finish=()=>{
      if(done)return;
      done=true;
      window.removeEventListener('avitech-greeting-done',finish);
      resolve();
    };
    window.addEventListener('avitech-greeting-done',finish,{once:true});
  });
}

async function start(){
  // Start loading and rendering the question immediately; do not block on the page greeting.
  localStorage.removeItem('quizResult');
  localStorage.removeItem('quizResults');
  localStorage.removeItem('resultData');
  // Do not let a previous subject/attempt bleed into this new test.
  localStorage.removeItem('lastAttemptId');
  const params=new URLSearchParams(location.search);
  bank=params.get('bank')==='aviation'?'aviation':'it';
  selectedSubject=(params.get('subject')||'').trim();

  try{
    const bankRequest=fetch(banks[bank], {cache:'default'});
    let r=await bankRequest;
    if(!r.ok) throw new Error(`Question bank failed to load (${r.status})`);
    let d=await r.json();

    // Keep the existing data filenames/structures. Normalize the two MCQ
    // banks into the common quiz shape expected by this page.
    if(!Array.isArray(d.questions)) throw new Error('Invalid question bank format');
    d.questions=d.questions.map(q=>{
      const options = Array.isArray(q.options) ? q.options : Object.values(q.options || {});
      const answer = q.answer ?? q.correctAnswer;
      return {...q, options, answer};
    });

    // IT and Aviation tests are topic-specific. Never mix topics when a topic
    // has been selected from a topic card.
    const aviationTopics=[
      'Aviation Fundamentals','Aircraft & Aircraft Systems','Flight Operations',
      'Airport Management','Aviation Safety','Aviation Security',
      'Aviation Regulations & Law','Airline Operations','Ground Handling','Cargo',
      'Aviation Communication','Human Factors in Aviation','Emergency Procedures',
      'Aviation General Knowledge','Cabin Crew Duties and Responsibilities','Aircraft Types'
    ];
    if(bank==='aviation' && selectedSubject && !aviationTopics.includes(selectedSubject)){
      throw new Error('Invalid aviation topic selected.');
    }
    questionPool=(selectedSubject && (bank==='it' || bank==='aviation'))
      ? d.questions.filter(q=>q.topic===selectedSubject)
      : d.questions;

    if(selectedSubject && questionPool.length<15){
      throw new Error(`Not enough questions for ${selectedSubject}`);
    }

    // Every MCQ test is exactly 15 questions: 3 Advanced + 6 Hard + 6 Medium.
    // NO Easy questions. Remove duplicate question text before selecting the round.
    // This guarantees the same question cannot appear twice in one test,
    // even if the question bank contains duplicate records with different IDs.
    const uniqueQuestions=[];
    const seenQuestionText=new Set();
    for(const q of questionPool){
      const key=String(q.question||'').trim().replace(/\s+/g,' ').toLowerCase();
      if(!key || seenQuestionText.has(key)) continue;
      seenQuestionText.add(key);
      uniqueQuestions.push(q);
    }
    questionPool=uniqueQuestions;

    const advanced=shuffle(questionPool.filter(q=>q.difficulty==='Advanced'));
    const hard=shuffle(questionPool.filter(q=>q.difficulty==='Hard'));
    const medium=shuffle(questionPool.filter(q=>q.difficulty==='Medium'));

    if(advanced.length<3 || hard.length<6 || medium.length<6){
      throw new Error(`The selected subject does not have enough Advanced, Hard and Medium questions.`);
    }

    qs=shuffle([
      ...advanced.slice(0,3),
      ...hard.slice(0,6),
      ...medium.slice(0,6)
    ]);

  answers=Array(15).fill(null);
  fiftyUsed=false;
  skipCount=0;
  changeUsed=false;
  submitted=false;
  resetExplanation();
  updateLifelines();

  // Camera + microphone permission is mandatory. Do not create an attempt
  // or reveal the active test until both permissions are granted.
  if(typeof window.requestProctoringPermissions==='function'){
    const permissionsOk=await window.requestProctoringPermissions();
    if(!permissionsOk) throw new Error('Camera and microphone permission is required to begin the test.');
  }

  initVoice();
  render();

  // Create a server-side attempt for the logged-in user before the test starts.
  // The attempt ID is also used by eye-detection/proctoring events.
  try{
    const attemptResponse=await fetch('/api/attempt/start',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        bank,
        subject:selectedSubject || null,
        started_at:new Date().toISOString()
      })
    });
    const attemptData=await attemptResponse.json();
    if(!attemptResponse.ok || !attemptData.ok) throw new Error(attemptData.error || 'Could not start test attempt');
    attemptId=Number(attemptData.attempt_id);
    testStartedAt=Date.now();
    // Bind this exact MCQ subject/bank to this exact server attempt. Never infer
    // the result language from an old quizResult or the HTML's default Python badge.
    localStorage.setItem('lastAttemptId',String(attemptId));
    localStorage.setItem('attempt_identity_'+String(attemptId),JSON.stringify({
      attemptId,
      bank:String(bank||'it').toLowerCase(),
      subject:String(selectedSubject||'').trim(),
      technology:bank==='aviation' ? 'AVITECH Aviation' : (String(selectedSubject||'').trim() || 'AVITECH IT'),
      testType:'MCQ'
    }));

    if(typeof window.startProctoring==='function'){
      const proctoringReady=await window.startProctoring(attemptId);
      if(!proctoringReady){
        // Keep the server attempt as a terminated record instead of allowing
        // the candidate to continue without mandatory phone/study-material
        // detection.
        await fetch('/api/attempt/finish',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            attempt_id:attemptId,
            bank,
            subject:selectedSubject || null,
            endedBy:'Proctoring could not start',
            test_type:'mcq',
            questions:[],
            lifelines:[],
            proctoring:typeof window.getProctoringSummary==='function'
              ? window.getProctoringSummary() : null
          }),
          keepalive:true
        }).catch(()=>{});
        throw new Error('Mandatory proctoring could not be started. The test was not started.');
      }
    }
  }catch(attemptError){
    console.error('Attempt could not be created:',attemptError);
    const status=$('voiceStatus');
    if(status) status.textContent='Could not save this test attempt. Please refresh and login again.';
  }
  }catch(err){
    console.error(err);
    const q=$('question');
    if(q) q.textContent='Question bank could not be loaded.';
    const f=$('feedback');
    if(f) f.textContent='Please make sure you started the Flask server and opened the test from http://127.0.0.1:5000.';
  }
}

function render(){
  // A new question gets its normal lifelines back. 50-50 itself remains
  // unavailable if it has already been used anywhere in the test.
  fiftyQuestionLock=false;
  // Render must preserve the current question's lifeline usage state.
  // Per-question lifelines are reset only when actually moving to a new question.
  stopVoice();
  let q=qs[cur];
  selected=answers[cur]||null;
  submitted=false;

  $('count').textContent=`${cur+1} / 15`;
  const diff=$('difficultyName'); if(diff) diff.textContent=q.difficulty||'Medium';
  $('question').innerHTML=`Question ${cur+1}:<br><span class="question-text">${escapeHtml(q.question)}</span>`;

  $('options').innerHTML=q.options.map((o,i)=>`
    <button class="option ${selected===o?'selected':''}" data-a="${esc(o)}" disabled>
      <span class="option-letter">${String.fromCharCode(65+i)}.</span>
      <span class="radio"></span><span>${esc(o)}</span>
    </button>
  `).join('');

  // Lock the entire question until the robot has finished speaking.
  setQuizLocked(true);
  document.querySelectorAll('.option').forEach(b=>{
    b.onclick=()=>{
      if(submitted || quizLocked) return;
      selected=b.dataset.a;
      answers[cur]=selected;
      document.querySelectorAll('.option').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      $('feedback').textContent='';
    };
  });

  $('next').textContent='Submit Answer  →';
  $('next').disabled=true;
  $('next').classList.remove('ready-next');

  resetExplanation();
  updateLifelines();

  // Render the question immediately. The voice waits only for the page greeting
  // to finish so the two voices never overlap.
  clearInterval(tid);
  t=60;
  const quizBoard=document.querySelector('.quiz');
  tick();
  setTimeout(()=>{
    waitForAvitechGreeting().then(()=>speakCurrentQuestion(true));
  },120);
}

let quizLocked=true;

function setQuizLocked(locked){
  quizLocked=locked;

  document.querySelectorAll('.option').forEach(b=>{
    b.disabled=locked || submitted;
    b.setAttribute('aria-disabled', locked ? 'true' : 'false');
    b.style.pointerEvents=locked ? 'none' : '';
  });

  const next=$('next');
  if(next){
    next.disabled=locked || (submitted && !selected);
    next.setAttribute('aria-disabled', next.disabled ? 'true' : 'false');
    next.style.pointerEvents=next.disabled ? 'none' : '';
  }

  const mic=$('mic');
  if(mic){
    // Mic is available after submit so the user can say "Next Question".
    // During a new question's robot reading it remains locked by `locked`.
    mic.disabled=locked;
    mic.setAttribute('aria-disabled', mic.disabled ? 'true' : 'false');
    mic.style.pointerEvents=mic.disabled ? 'none' : '';
  }

  // Disable every lifeline while the robot is speaking.
  document.querySelectorAll('#fifty, #hint, #change, #skip, .lifeline, [data-lifeline]').forEach(b=>{
    const otherLifelineLocked = fiftyQuestionLock && b.id !== 'fifty';
    const disabled = locked || lifelinesLockedAfterSubmit || otherLifelineLocked;
    b.disabled=disabled;
    b.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    b.style.pointerEvents=disabled ? 'none' : '';
  });

  const status=$('voiceStatus');
  if(status) status.textContent=locked ? '🤖 Robot is reading the question...' : '';
}

function startTimerAfterSpeech(){
  // Speech completion is the ONLY place where a new question becomes active.
  if(!quizLocked) return;

  quizLocked=false;
  document.querySelectorAll('.option').forEach(b=>{
    b.disabled=false;
    b.setAttribute('aria-disabled','false');
    b.style.pointerEvents='';
  });

  const next=$('next');
  if(next){
    next.disabled=false;
    next.setAttribute('aria-disabled','false');
    next.style.pointerEvents='';
  }

  const mic=$('mic');
  if(mic){
    mic.disabled=false;
    mic.setAttribute('aria-disabled','false');
    mic.style.pointerEvents='';
  }

  document.querySelectorAll('#fifty, #hint, #change, #skip, .lifeline, [data-lifeline]').forEach(b=>{
    const otherLifelineLocked = fiftyQuestionLock && b.id !== 'fifty';
    const disabled = lifelinesLockedAfterSubmit || otherLifelineLocked;
    b.disabled=disabled;
    b.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    b.style.pointerEvents=disabled ? 'none' : '';
  });

  const status=$('voiceStatus');
  if(status) status.textContent='';

  clearInterval(tid);
  t=60;
  const quizBoard=document.querySelector('.quiz');
  tick();
  tid=setInterval(()=>{
    t--;
    tick();
    if(t<=0){
      clearInterval(tid);
      if(!submitted) timeExpired();
    }
  },1000);
}

function tick(){
  const timeEl=$('time');
  if(timeEl) timeEl.textContent=`00:${String(Math.max(0,t)).padStart(2,'0')}`;
  const danger = t <= 10 && t > 0;
  const timerEl=timeEl ? timeEl.closest('.timer') : null;
  if(timerEl) timerEl.classList.toggle('timer-danger', danger);
  const quizBoard=document.querySelector('.quiz');
}

function submitAnswer(autoSubmit=false){
  if(quizLocked) return;
  stopVoice();

  if(submitted){
    nextQuestion();
    return;
  }

  if(!selected){
    $('feedback').textContent='Please select an answer before submitting.';
    return;
  }

  // User has actually submitted an answer:
  // keep lifelines disabled, but DO NOT lock the Next Question button.
  lifelinesLockedAfterSubmit=true;

  clearInterval(tid);
  answers[cur]=selected;
  submitted=true;

  // Keep options/mic disabled because `submitted` is true,
  // while leaving Next Question clickable.
  setQuizLocked(false);

  document.querySelectorAll('.option').forEach(b=>{
    b.disabled=true;
    b.style.cursor='default';
  });

  const q=qs[cur];
  const correct=selected===q.answer;

  // Keep mic locked while the robot reads the result.
  // It is re-enabled when that speech finishes, allowing "Next Question".
  const mic=$('mic');
  if(mic){
    mic.disabled=true;
    mic.setAttribute('aria-disabled','true');
    mic.style.pointerEvents='none';
  }

  showAnswerResult(q,selected,correct,autoSubmit);

  $('next').textContent=cur===14?'Finish Test  →':'Next Question  →';
  $('next').classList.add('ready-next');
}

function timeExpired(){
  if(submitted) return;
  stopVoice();
  clearInterval(tid);

  // Timeout consumes one Skip. If the user already used all 3 manual
  // skips, this becomes the automatic fourth skip and ends the test.
  skipCount++;
  answers[cur]=null;
  updateLifelines();

  if(skipCount>=4){
    finishTest('4th skip used automatically by timeout — test over');
    return;
  }

  if(cur<14){
    cur++;
    render();
    $('feedback').textContent=`Time is over. Question automatically skipped. ${3-skipCount} skip${3-skipCount===1?'':'s'} left.`;
  }else{
    finishTest('time over on final question');
  }
}
function nextQuestion(){
if(quizLocked) return;
  if(!submitted){
    submitAnswer(false);
    return;
  }

  if(cur<14){
    cur++;
    // Move to the next question. Test-wide lifeline state is preserved.
    lifelinesLockedAfterSubmit = false;
    render();
  }else{
    finishTest('completed');
  }
}

// Turns a raw answer/topic string into a readable concept label for the
// dashboard, e.g. "custom properties" -> "Custom properties". Strings that
// already start with an uppercase letter (XLOOKUP, IQueryable, PL/SQL...)
// are left exactly as authored in the question bank.
function conceptLabel(term){
  const s=String(term||'').trim();
  if(!s) return '';
  return /^[a-z]/.test(s) ? s.charAt(0).toUpperCase()+s.slice(1) : s;
}

async function finishTest(reason){
  if(window.quizFinished) return;
  window.quizFinished=true;
  clearInterval(tid);
  stopVoice();

  const questions=qs.map((q,i)=>{
    const skipped = answers[i] === null || answers[i] === undefined || answers[i] === '';
    const subtopic = bank==='aviation'
      ? (q.topic || 'General')
      : (conceptLabel(q.answer) || q.topic || 'General');

    return {
      id:q.id || q.questionId || '',
      question:q.question,
      chosenAnswer: skipped ? 'Skip' : answers[i],
      rightAnswer:q.answer,
      isCorrect:!skipped && answers[i]===q.answer,
      skipped,
      topic:q.topic,
      subtopic,
      difficulty:q.difficulty || 'Medium',
      timeTaken:0
    };
  });

  const topicMap={};
  questions.forEach(q=>{
    const name=String(q.subtopic||q.topic||selectedSubject||bank).trim() || bank;
    if(!topicMap[name]) topicMap[name]={name,total:0,correct:0,skipped:0};
    topicMap[name].total++;
    if(q.skipped) topicMap[name].skipped++;
    else if(q.isCorrect) topicMap[name].correct++;
  });
  const topics=Object.values(topicMap).map(t=>({
    name:t.name,
    score:t.total ? Math.round((t.correct/t.total)*100) : 0,
    correct:t.correct,
    total:t.total,
    skipped:t.skipped
  })).sort((a,b)=>b.score-a.score);

  const result={
    technology: bank==='aviation'
      ? 'AVITECH Aviation'
      : (selectedSubject || 'AVITECH IT'),
    bank,
    subject: selectedSubject,
    total:15,
    score:answers.reduce((n,a,i)=>n+(a===qs[i].answer?1:0),0),
    endedBy:reason||'completed',
    test_type:'mcq',
    topics,
    questions,
    attemptId,
    proctoringAttemptId:attemptId,
    proctoring:typeof window.getProctoringSummary==='function'
      ? window.getProctoringSummary()
      : null,
    proctoringEvents:typeof window.getProctoringEvents==='function'
      ? window.getProctoringEvents()
      : []
  };

  // Persist the complete attempt against the currently logged-in account.
  if(attemptId){
    try{
      const saveResponse=await fetch('/api/attempt/finish',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          attempt_id:attemptId,
          bank,
          subject:selectedSubject || null,
          endedBy:reason||'completed',
          test_type:'mcq',
          questions,
          lifelines:[],
          proctoring:typeof window.getProctoringSummary==='function'
            ? window.getProctoringSummary()
            : null
        }),
        keepalive:true
      });
      if(!saveResponse.ok){
        console.error('Could not save test result:',await saveResponse.text());
      }else{
        const authoritative=await saveResponse.json();
        if(authoritative && authoritative.ok){
          result.score=Number(authoritative.correct||0);
          result.correct=Number(authoritative.correct||0);
          result.wrong=Number(authoritative.wrong||0);
          result.skipped=Number(authoritative.skipped||0);
          result.total=Number(authoritative.total||15);
          result.percentage=Number(authoritative.percentage||0);
          result.questions=(authoritative.questions||[]).map(q=>({
            id:q.id, question:q.question, chosenAnswer:q.selected_answer||'',
            rightAnswer:q.correct_answer||'', isCorrect:Boolean(q.is_correct),
            skipped:Boolean(q.is_skipped), difficulty:q.difficulty,
            topic:q.topic, subtopic:q.subtopic, timeTaken:Number(q.time_taken||0)
          }));
        }
      }
    }catch(saveError){
      console.error('Could not save test result:',saveError);
    }
  }

  if(typeof window.stopProctoring==='function'){
    try{ window.stopProctoring(); }catch(e){}
  }

  localStorage.setItem('quizResult',JSON.stringify(result));
  // Bind the report to THIS attempt; never let /result fall back to a previous test.
  location.href=attemptId ? `/result?attempt=${encodeURIComponent(attemptId)}` : '/result?attempt_missing=1';
}
function speakRobot(text,onDone){
  speakRobotSequence([String(text)], onDone);
}

function speakRobotSequence(parts,onDone){
  const queue=(parts||[]).map(x=>String(x)).filter(Boolean);

  if(!queue.length){
    if(typeof onDone==='function') onDone();
    return;
  }

  if(!('speechSynthesis' in window)){
    if(typeof onDone==='function') onDone();
    return;
  }

  try{
    speechSynthesis.cancel();

    let index=0;

    const speakNext=()=>{
      if(index>=queue.length){
        document.body.classList.remove('robot-speaking');
        const s=$('voiceStatus');
        if(s) s.textContent='';
        if(typeof onDone==='function') onDone();
        return;
      }

      const spokenText=String(queue[index++]);
      const u=new SpeechSynthesisUtterance(spokenText);
      u.lang='en-IN';
      u.rate=0.90;
      u.pitch=1.02;
      u.volume=1;

      u.onstart=()=>{
        document.body.classList.add('robot-speaking');
        const s=$('voiceStatus');
        if(s) s.textContent='Robot speaking...';
      };

      u.onend=()=>{
        // Speak the next part only after this part is completely finished.
        setTimeout(speakNext,80);
      };

      u.onerror=()=>{
        // Never leave the quiz permanently locked if the browser voice engine errors.
        speakNext();
      };

      speechSynthesis.speak(u);
    };

    speakNext();
  }catch(e){
    if(typeof onDone==='function') onDone();
  }
}

function speakCurrentQuestion(lockUntilDone=false){
const q=qs[cur];
  if(!q) return;

  // Normal question voice speaks ONLY the question. Options stay visible on screen.
  const parts=[
    `Question ${cur+1}. ${q.question}.`
  ];

  if(lockUntilDone){
    setQuizLocked(true);
    speakRobotSequence(parts, startTimerAfterSpeech);
  }else{
    speakRobotSequence(parts);
  }
}

function speakExplanation(q,chosen,correct,onDone){
  if(!q){
    if(typeof onDone==='function') onDone();
    return;
  }
  const answer = String(q.answer || '');
  const selectedAnswer = String(chosen || '');
  const result = correct
    ? `Correct answer. The correct answer is ${answer}.`
    : `Incorrect answer. The correct answer is ${answer}. Your answer was ${selectedAnswer}.`;
  speakRobot(result,onDone);
}

function initVoice(){
  const mic=$('mic');
  const status=$('voiceStatus');
  if(!mic || !status) return;

  if(!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)){
    mic.disabled=true;
    status.textContent='Voice answer is not supported in this browser. Use Chrome or Edge.';
    return;
  }

  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SpeechRecognition();
  recognition.lang='en-IN';
  recognition.continuous=false;
  recognition.interimResults=false;
  recognition.maxAlternatives=3;

  recognition.onstart=()=>{
    window.avitecVoiceAnswerActive=true;
    listening=true;
    mic.classList.add('listening');
    mic.textContent='🔴  Listening...';
    status.textContent='Speak the option text or option letter.';
  };

  recognition.onresult=(event)=>{
    const transcript=event.results[0][0].transcript.trim();
    const options=qs[cur].options;
    if(handleVoiceLifelineCommand(transcript)){
      status.textContent=`Voice command: ${transcript}`;
      return;
    }

    // After submission, voice is for navigation commands only.
    if(submitted){
      status.textContent=`Voice command not recognized: "${transcript}"`;
      return;
    }

    const match=findVoiceAnswer(transcript,options);

    if(match){
      selected=match;
      answers[cur]=match;
      document.querySelectorAll('.option').forEach(x=>{
        x.classList.toggle('selected',x.dataset.a===match);
      });
      status.textContent=`Selected: ${match}`;
      $('feedback').textContent='';

      // Voice answer behaves exactly like clicking Submit Answer:
      // select the option first, then submit it automatically.
      setTimeout(()=>{
        if(!submitted && selected===match && !quizLocked){
          submitAnswer(false);
        }
      },180);
    }else{
      status.textContent=`Heard: "${transcript}". Could not match an option. Try again.`;
    }
  };

  recognition.onerror=(event)=>{
    window.avitecVoiceAnswerActive=false;
    listening=false;
    mic.classList.remove('listening');
    mic.textContent='🎙️';
    if(event.error==='not-allowed'){
      status.textContent='Microphone permission was blocked. Allow microphone access and try again.';
    }else{
      status.textContent='Could not hear a valid answer. Try again.';
    }
  };

  recognition.onend=()=>{
    window.avitecVoiceAnswerActive=false;
    listening=false;
    mic.classList.remove('listening');
    mic.textContent='🎙️';
  };

  mic.onclick=()=>{
    if(quizLocked) return;
    if('speechSynthesis' in window) speechSynthesis.cancel();
    if(listening){
      stopVoice();
    }else{
      try{
        recognition.start();
      }catch(e){}
    }
  };
}

function stopVoice(){
  if(recognition){
    try{recognition.stop()}catch(e){}
  }
  listening=false;
  const mic=$('mic');
  if(mic){
    mic.classList.remove('listening');
    mic.textContent='🎙️';
  }
}

function normalizeVoice(v){
  return String(v).toLowerCase()
    .replace(/[.,!?;:'"()]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}


function handleVoiceLifelineCommand(transcript){
  const t=normalizeVoice(transcript);
  if(!t) return false;

  // Only interpret these commands when the user is not answering with an option.
  // 50-50
  if(/\b(?:use|activate|apply|open)?\s*(?:50\s*[- ]?\s*50|fifty\s*[- ]?\s*fifty)\b/.test(t) ||
     /\b(?:fifty fifty)\b/.test(t)){
    const b=document.getElementById('fifty');
    if(b && !b.disabled){
      b.click();
      return true;
    }
    return false;
  }

  // Skip
  if(/\b(?:skip|skip this|skip question|skip the question)\b/.test(t)){
    const b=document.getElementById('skip');
    if(b && !b.disabled){
      b.click();
      return true;
    }
    return false;
  }

  // Change the Question
  if(/\b(?:change|change question|change the question|replace question|another question)\b/.test(t)){
    const b=document.getElementById('hint');
    if(b && !b.disabled){
      b.click();
      return true;
    }
    return false;
  }

  // Next Question
  // This is available after an answer has been submitted, just like clicking
  // the visible Next Question button. Do not bypass the button's own state.
  if(/\b(?:next|next question|go next|go to next question|continue|continue to next)\b/.test(t)){
    const b=document.getElementById('next');
    if(b && !b.disabled && submitted){
      b.click();
      return true;
    }
    return false;
  }

  return false;
}

function findVoiceAnswer(transcript,options){
  const t=normalizeVoice(transcript);
  if(!t) return null;

  // Direct option text match. This also handles longer natural phrases
  // such as "I choose option HTML" when the option text is HTML.
  for(const o of options){
    const n=normalizeVoice(o);
    if(t===n || t.includes(n) || n.includes(t)) return o;
  }

  // Accept A/B/C/D in natural spoken forms:
  // "A", "option A", "answer A", "choice A", "select A", etc.
  const letters=['a','b','c','d'];
  const letterMatch=t.match(/\b(?:option|answer|choice|select|choose)\s*([abcd])\b/) ||
                    t.match(/\b([abcd])\s*(?:option|answer|choice)\b/) ||
                    t.match(/\b([abcd])\b/);
  if(letterMatch){
    const idx=letters.indexOf(letterMatch[1]);
    if(idx>=0 && idx<options.length) return options[idx];
  }

  // Spoken ordinal/number forms are also accepted.
  const spoken={
    first:'a', second:'b', third:'c', fourth:'d',
    one:'a', two:'b', three:'c', four:'d',
    'number one':'a', 'number two':'b', 'number three':'c', 'number four':'d',
    'option one':'a', 'option two':'b', 'option three':'c', 'option four':'d',
    'choice one':'a', 'choice two':'b', 'choice three':'c', 'choice four':'d'
  };
  for(const phrase of Object.keys(spoken)){
    if(t===phrase || t.includes(phrase)){
      const idx=letters.indexOf(spoken[phrase]);
      if(idx>=0 && idx<options.length) return options[idx];
    }
  }
  return null;
}

function showAnswerResult(q,chosen,correct,autoSubmit){
  const icon=$('resultIcon');
  const title=$('resultTitle');
  const review=$('answerReview');
  const heading=$('explanationHeading');

  if(correct){
    icon.textContent='✓';
    title.textContent='CORRECT ANSWER';
    title.className='correct-title';

    review.innerHTML=`
      <p class="correct-line"><strong>Correct answer:</strong> ${esc(chosen)} <span class="check">✓</span></p>
    `;
    heading.textContent='Explanation:';
    $('feedback').innerHTML=buildExplanationHtml(q);

    $('explainBox').classList.remove('wrong-box');
    $('explainBox').classList.add('correct-box');
  }else{
    icon.textContent='✕';
    title.textContent='INCORRECT ANSWER';
    title.className='wrong-title';

    review.innerHTML=`
      <p class="correct-line"><strong>Correct answer:</strong> ${esc(q.answer)} <span class="check">✓</span></p>
      <p class="wrong-line"><strong>Your answer:</strong> ${esc(chosen)} <span class="cross">✕</span></p>
    `;
    heading.textContent='Explanation:';
    $('feedback').innerHTML=buildExplanationHtml(q);

    $('explainBox').classList.remove('correct-box');
    $('explainBox').classList.add('wrong-box');
  }

  if(autoSubmit){
    $('feedback').textContent += ' Time ended, so your selected answer was submitted. Click “Next Question” to continue.';
  }

  // Robot reads the result first. Once finished, enable the mic so
  // the user can say "Next Question" without touching the button.
  speakExplanation(q,chosen,correct,()=>{
    if(submitted){
      const mic=$('mic');
      if(mic){
        mic.disabled=false;
        mic.setAttribute('aria-disabled','false');
        mic.style.pointerEvents='';
      }
    }
  });
}

function buildExplanationText(q){
  const answer=String(q.answer||'').trim();
  const base=String(q.explanation||'').trim();
  const topic=String(q.topic||'').trim();

  if(base){
    return base;
  }

  const question=String(q.question||'').trim();
  return `The question is testing “${answer}” in the context of ${topic || 'this subject'}. The wording of the question points to this concept, and the correct answer is the option that matches the role or definition being asked about. ${question ? `Question focus: ${question}` : ''}`.trim();
}

function buildDetailedAnswerText(q){
  const answer=String(q.answer||'').trim();
  const base=String(q.explanation||'').trim();
  const topic=String(q.topic||'').trim();

  if(!answer) return '';

  if(base){
    return `${answer} is the specific ${topic ? `${topic} ` : ''}concept being tested in this question. ${base} In simple terms, the key idea is to connect the description in the question with the role or meaning of “${answer}”. This is why this option fits the question better than an unrelated concept.`;
  }

  return `“${answer}” is the concept identified by the question. In ${topic || 'this subject'}, focus on the definition, role, or purpose described in the question and connect those key words with “${answer}”. That direct match is what makes this the correct choice.`;
}

function getRelatedAnswerDetails(q){
  const answer=String(q.answer||'').trim().toLowerCase();
  if(!answer || !Array.isArray(questionPool)) return [];

  const seen=new Set();
  const details=[];
  for(const item of questionPool){
    if(!item || String(item.answer||'').trim().toLowerCase()!==answer) continue;
    const text=String(item.explanation||'').trim();
    if(!text) continue;
    const key=text.replace(/\s+/g,' ').toLowerCase();
    if(!seen.has(key)){
      seen.add(key);
      details.push(text);
    }
    if(details.length>=3) break;
  }
  return details;
}

function buildExplanationHtml(q) {
  const base = String(q.explanation || '').trim();
  const answerDetail = buildDetailedAnswerText(q);
  const related = getRelatedAnswerDetails(q).filter(x => x.replace(/\s+/g,' ').toLowerCase() !== base.replace(/\s+/g,' ').toLowerCase());

  return `
    <div class="why-box detailed-why-box">
      <div class="detailed-answer-section">
        <div class="detail-heading">📘 Answer in Detail</div>
        <p>${esc(answerDetail)}</p>
      </div>

      ${related.length ? `
      <div class="detailed-answer-section related-details">
        <div class="detail-heading">🔎 More about this concept</div>
        ${related.slice(0,2).map(x=>`<p>• ${esc(x)}</p>`).join('')}
      </div>` : ''}
    </div>`;
}

function buildExplanation(q){
  return buildExplanationText(q);
}

function resetExplanation(){
  $('resultIcon').textContent='💡';
  $('resultTitle').textContent='Explanation of question';
  $('resultTitle').className='';
  $('answerReview').innerHTML='';
  $('explanationHeading').textContent='Explanation:';
  $('feedback').textContent="";
  $('explainBox').classList.remove('correct-box','wrong-box');
}

function updateLifelines(){
  // Used lifelines stay visible as disabled red buttons instead of disappearing.
  const fiftyBtn = $('fifty');
  const changeBtn = $('hint');
  if(fiftyBtn){
    fiftyBtn.style.display='';
    fiftyBtn.classList.toggle('lifeline-used', fiftyUsed);
    fiftyBtn.disabled = quizLocked || lifelinesLockedAfterSubmit || fiftyUsed;
    fiftyBtn.setAttribute('aria-disabled', fiftyBtn.disabled ? 'true' : 'false');
    fiftyBtn.style.pointerEvents = '';
  }
  if(changeBtn){
    changeBtn.style.display='';
    changeBtn.classList.toggle('lifeline-used', changeUsed);
  }
  $('hint').disabled = quizLocked || lifelinesLockedAfterSubmit || changeUsed || fiftyQuestionLock;
  $('hint').setAttribute('aria-disabled', $('hint').disabled ? 'true' : 'false');
  $('hint').style.pointerEvents = '';
  const skipBtn=$('skip');
  if(skipBtn){
    const exhausted=skipCount>=3;
    skipBtn.textContent=exhausted ? '✕  Skip (0 left)' : `|◀  Skip (${3-skipCount} left)`;
    skipBtn.classList.toggle('skip-exhausted', exhausted);
    skipBtn.disabled=quizLocked || lifelinesLockedAfterSubmit || exhausted || fiftyQuestionLock;
    skipBtn.setAttribute('aria-disabled', skipBtn.disabled ? 'true' : 'false');
    skipBtn.style.pointerEvents=skipBtn.disabled ? 'none' : '';
  }
}

$('next').onclick=()=>nextQuestion();

$('skip').onclick=()=>{
  if(quizLocked) return;
    if(submitted){
    nextQuestion();
    return;
  }

  // After 3 manual skips the Skip lifeline is disabled.
  // A click can never trigger a fourth manual skip.
  if(skipCount>=3 || fiftyQuestionLock){
    updateLifelines();
    return;
  }

  stopVoice();

  skipCount++;
  answers[cur]=null;
  updateLifelines();

  if(cur<14){
    cur++;
    render();
    $('feedback').textContent=`Question skipped. ${3-skipCount} skip${3-skipCount===1?'':'s'} left.`;
  }else{
    finishTest('completed');
  }
};

$('fifty').onclick=()=>{
  if(quizLocked) return;
  if(fiftyUsed) return;

  fiftyUsed=true;
  // On this question only, the other two lifelines cannot be used.
  fiftyQuestionLock=true;
  const q=qs[cur];

  // Remove exactly two incorrect options.
  const allButtons=[...document.querySelectorAll('.option')];
  const wrongButtons=shuffle(allButtons.filter(b=>b.dataset.a!==q.answer)).slice(0,2);

  wrongButtons.forEach(b=>{
    b.disabled=true;
    b.style.opacity='.35';
    b.style.pointerEvents='none';
    b.classList.remove('selected');
  });

  // The remaining options must NOT be selectable while the AI explains 50-50.
  const remaining=allButtons.filter(b=>!wrongButtons.includes(b));
  const remainingSpeech=remaining.map(b=>{
    const index=allButtons.indexOf(b);
    const letter=String.fromCharCode(65+index);
    return `Option ${letter}: ${b.dataset.a}.`;
  });

  updateLifelines();

  const speechParts=[
    'I am removing the two incorrect options.',
    'Your remaining options are.',
    ...remainingSpeech
  ];

  // Lock ALL quiz controls while 50-50 speech is playing.
  setQuizLocked(true);
  $('feedback').textContent='';

  // After speech is fully finished, unlock the remaining options and controls.
  speakRobotSequence(speechParts, ()=>{
    // Keep the two eliminated choices disabled.
    quizLocked=false;

    remaining.forEach(b=>{
      b.disabled=!!submitted;
      b.setAttribute('aria-disabled', b.disabled ? 'true' : 'false');
      b.style.pointerEvents=submitted ? 'none' : '';
      b.style.opacity='';
    });

    const next=$('next');
    if(next){
      next.disabled=!!submitted && !selected;
      next.setAttribute('aria-disabled', next.disabled ? 'true' : 'false');
      next.style.pointerEvents=next.disabled ? 'none' : '';
    }

    const mic=$('mic');
    if(mic){
      mic.disabled=!!submitted;
      mic.setAttribute('aria-disabled', submitted ? 'true' : 'false');
      mic.style.pointerEvents=submitted ? 'none' : '';
    }

    // Restore normal lifeline state after 50-50 speech.
    // 50-50 itself stays disabled because it is a one-time lifeline,
    // while Skip remains available up to its own 3-use limit and
    // Change the Question remains available until it is used.
    updateLifelines();

    const status=$('voiceStatus');
    if(status) status.textContent='';
  });
};

$('hint').onclick=()=>{
  if(quizLocked) return;
    if(changeUsed || fiftyQuestionLock) return;

  stopVoice();
  changeUsed=true;
  const currentId=qs[cur].question;
  const currentDifficulty=qs[cur].difficulty;

  // A changed question must also be new to this test. Exclude every
  // question already present in `qs` (except the question being replaced).
  const usedKeys=new Set(qs.map((q,i)=>i===cur ? null : String(q.question||'').trim().replace(/\s+/g,' ').toLowerCase()).filter(Boolean));
  const currentKey=String(currentId||'').trim().replace(/\s+/g,' ').toLowerCase();
  const sameLevel=questionPool.filter(q=>{
    const key=String(q.question||'').trim().replace(/\s+/g,' ').toLowerCase();
    return q.difficulty===currentDifficulty && key!==currentKey && !usedKeys.has(key);
  });
  const unusedAnyLevel=questionPool.filter(q=>{
    const key=String(q.question||'').trim().replace(/\s+/g,' ').toLowerCase();
    return key!==currentKey && !usedKeys.has(key);
  });
  const replacement=shuffle(sameLevel.length?sameLevel:unusedAnyLevel)[0];

  if(replacement) qs[cur]=replacement;

  selected=null;
  answers[cur]=null;

  // Button stays visible and becomes disabled/red after one use.
  updateLifelines();
  render();
  $('feedback').textContent='Question changed. This lifeline can be used only once.';
};

function esc(s){
  return String(s).replace(/[&<>"']/g,m=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[m]));
}

start().catch(console.error);


function buildTopicAreas(results) {
  const stats = {};
  (results || []).forEach(r => {
    if (!r || r.skipped || r.result === "Skipped" || r.status === "skipped") return;
    const topic = r.topic || r.subject || r.language || "General";
    if (!stats[topic]) stats[topic] = {correct:0, answered:0};
    stats[topic].answered++;
    if (r.correct === true || r.isCorrect === true || r.result === "Correct" || r.status === "correct") {
      stats[topic].correct++;
    }
  });

  const rows = Object.entries(stats)
    .map(([topic, s]) => ({topic, pct: s.answered ? Math.round(s.correct/s.answered*100) : 0, answered:s.answered}))
    .sort((a,b) => b.pct-a.pct);

  return {
    strong: rows.filter(x => x.pct >= 70).slice(0, 3),
    weak: rows.filter(x => x.pct < 70).sort((a,b) => a.pct-b.pct).slice(0, 3)
  };
}

function renderTopicAreaCards(results) {
  const areas = buildTopicAreas(results);
  const strong = areas.strong;
  const weak = areas.weak;

  const strongBox = document.querySelector(".strong-areas, #strongAreas, [data-area='strong']");
  const weakBox = document.querySelector(".weak-areas, #weakAreas, [data-area='weak']");

  function card(title, items, kind) {
    const icon = kind === "strong" ? "📈" : "📉";
    const color = kind === "strong" ? "#16b979" : "#ff4264";
    if (!items.length) {
      return `<div class="area-empty">No separate area identified.</div>`;
    }
    return `<div class="area-items">${items.map(x => `
      <div class="area-topic">
        <div class="area-topic-head"><span>${icon} ${escapeHtml(x.topic)}</span><b>${x.pct}%</b></div>
        <div class="area-track"><div class="area-fill" style="width:${x.pct}%;background:${color}"></div></div>
      </div>`).join("")}</div>`;
  }

  if (strongBox) strongBox.innerHTML = card("Strong Areas", strong, "strong");
  if (weakBox) weakBox.innerHTML = card("Weak Areas", weak, "weak");
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    const raw = localStorage.getItem("quizResult") || localStorage.getItem("quizResults") || localStorage.getItem("resultData");
    if (!raw) return;
    const data = JSON.parse(raw);
    const results = data.results || data.answers || data.questionResults || (Array.isArray(data) ? data : []);
    renderTopicAreaCards(results);
  } catch (e) {}
});



