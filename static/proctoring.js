
(function(){
  const P = {
    video:null, status:null, warning:null, faceCount:null, lookCount:null,
    attemptId:null, stream:null, timer:null, running:false, terminated:false, terminationRequested:false,
    events:[], lookWarnings:0, lookingEpisode:false, noFaceStarted:null, noFaceWarned:false, blurCount:0,
    noFaceMs:0, closedEpisode:false, closedStarted:null, headEpisode:false,
    downEpisode:false, lastEvent:{}, modelReady:false, objectModel:null, objectModelReady:false,
    objectTimer:null, objectBusy:false, objectCanvas:null, phoneStreak:0, permissionStream:null, permissionsGranted:false, permissionPromise:null, phoneActive:false, studyStreak:0, studyActive:false,
    lastSnapshot:null, lastSnapshotAt:0, objectBadge:null,
    audioCtx:null, audioTimer:null, voiceWarnings:0, voiceSpeechMs:0, voiceSilenceMs:0, voiceCooldownUntil:0,
    voiceNoise:null, voiceCalib:[], lastHeadTurnAt:0, mouthSamples:[], appSpeechUntil:0, voiceFrames:[], voiceActive:false
  };

  // ---- Voice / helper detection settings (tune here) ----
  const VOICE_MAX_WARNINGS=3;          // terminate on 3rd voice incident; only first 2 incidents show warnings
  const VOICE_COOLDOWN_MS=6000;        // gap before the next incident can be raised
  const VOICE_CALIBRATION_MS=3000;     // initial room-noise measurement
  const VOICE_FRAME_MS=100;            // analysis step
  const VOICE_WINDOW_MS=5000;          // sliding window used to judge "sustained speech"
  const VOICE_MIN_SPEECH_MS=2500;      // voiced time needed inside the window (pauses allowed)
  const VOICE_ON_DB=12;                // dB above noise floor to START counting a frame as voice
  const VOICE_OFF_DB=8;                // dB above noise floor to KEEP counting it (hysteresis)
  const VOICE_MIN_ABS_DB=-58;          // never treat anything quieter than this (dBFS) as voice
  const VOICE_MIN_BAND_RATIO=0.5;      // share of energy in 300-3400 Hz
  const VOICE_MAX_FLATNESS=0.45;       // spectral flatness: noise ~1, voiced speech is much lower
  const VOICE_MIN_ENV_STD_DB=1.5;      // speech level fluctuates; constant hum/tone does not
  const VOICE_OWN_LIPS_FRAC=0.5;       // >= this share of voiced frames with lips moving => candidate
  const VOICE_OTHER_LIPS_FRAC=0.2;     // <= this share (with a visible face) => likely someone else

  const nowISO=()=>new Date().toISOString();
  const byId=id=>document.getElementById(id);

  // Browser-only flagged snapshots: never uploaded to Flask/server storage.
  const SNAP_DB_NAME='avitec_proctor_flagged_snapshots';
  const SNAP_STORE='snapshots';
  function openSnapshotDB(){return new Promise(resolve=>{if(!window.indexedDB){resolve(null);return;}const req=indexedDB.open(SNAP_DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(SNAP_STORE))req.result.createObjectStore(SNAP_STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);});}
  async function saveLocalSnapshot(attemptId,snap){const db=await openSnapshotDB();if(!db||!snap)return null;const id=`${attemptId}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;await new Promise(done=>{const tx=db.transaction(SNAP_STORE,'readwrite');tx.objectStore(SNAP_STORE).put({...snap,id,attemptId:String(attemptId)});tx.oncomplete=done;tx.onerror=done;});db.close();return id;}
  window.getLocalProctorSnapshots=async function(attemptId){const db=await openSnapshotDB();if(!db)return [];return await new Promise(resolve=>{const tx=db.transaction(SNAP_STORE,'readonly');const req=tx.objectStore(SNAP_STORE).getAll();req.onsuccess=()=>{const rows=(req.result||[]).filter(x=>String(x.attemptId)===String(attemptId));db.close();resolve(rows);};req.onerror=()=>{db.close();resolve([]);};});};
  window.clearLocalProctorSnapshots=async function(attemptId){const db=await openSnapshotDB();if(!db)return;await new Promise(done=>{const tx=db.transaction(SNAP_STORE,'readwrite');const st=tx.objectStore(SNAP_STORE);const req=st.getAll();req.onsuccess=()=>{(req.result||[]).filter(x=>String(x.attemptId)===String(attemptId)).forEach(x=>st.delete(x.id));};tx.oncomplete=done;tx.onerror=done;});db.close();};

  function uiWarning(text){
    if(!P.warning) return;
    P.warning.textContent=text||'';
    P.warning.classList.toggle('show',!!text);
    if(text) setTimeout(()=>{ if(P.warning.textContent===text){P.warning.textContent='';P.warning.classList.remove('show');}},4500);
  }

  // Persistent indicator for object-detection health. Unlike uiWarning(),
  // this never auto-clears — a failed phone/notes detector needs to stay
  // visibly flagged for the whole test, not disappear after 4.5s.
  function setObjectBadge(state, text){
    if(!P.objectBadge) return;
    P.objectBadge.textContent=text||'';
    P.objectBadge.dataset.state=state||'';
    P.objectBadge.hidden=!text;
  }

  function updateStats(faces){
    if(P.faceCount) P.faceCount.textContent=String(faces);
    if(P.lookCount) P.lookCount.textContent=`${Math.min(P.lookWarnings,2)}/2`;
  }

  function snapshot(){
    if(!P.video || P.video.readyState<2 || !P.video.videoWidth) return null;
    try{
      const c=document.createElement('canvas');
      c.width=Math.min(P.video.videoWidth,640);
      c.height=Math.round(c.width*(P.video.videoHeight/P.video.videoWidth));
      const ctx=c.getContext('2d');
      ctx.drawImage(P.video,0,0,c.width,c.height);
      return c.toDataURL('image/jpeg',0.62);
    }catch(e){ return null; }
  }

  async function record(type, details={}, takeSnapshot=true, preferCachedSnapshot=false){
    const event={
      event_type:type,
      occurred_at:nowISO(),
      details,
      snapshot:null
    };
    P.events.push(event);

    // Privacy mode: flagged frames stay only in this browser's IndexedDB.
    // They are NEVER sent to Flask/server storage and are cleared on the result page.
    let image=null;
    if(takeSnapshot && P.video){image=snapshot();if(image&&P.attemptId){event.local_snapshot_id=await saveLocalSnapshot(P.attemptId,{eventType:type,occurredAt:event.occurred_at,data:image});}}
    event.snapshot=!!event.local_snapshot_id;
    if(!P.attemptId) return event;

    try{
      const r=await fetch('/api/proctor/event',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          attempt_id:P.attemptId,
          event_type:type,
          occurred_at:event.occurred_at,
          details,
          snapshot:null
        }),
        keepalive:true
      });
      if(r.ok){
        const d=await r.json();
        event.server_id=d.event_id||null;
        event.snapshot_path=d.snapshot_path||null;
      }
    }catch(e){
      console.warn('Proctor event could not be saved',e);
    }
    return event;
  }

  function isActive(){
    return P.running && !P.terminated && !P.terminationRequested && !window.quizFinished;
  }

  async function terminate(reason){
    if(P.terminated) return;
    P.terminationRequested=true;
    P.terminated=true;
    P.running=false;
    clearInterval(P.timer);
    clearInterval(P.objectTimer);
    P.objectTimer=null;
    stopVoiceMonitor();
    document.body.classList.add('proctor-terminated');

    const modal=byId('testOverModal');
    const reasonEl=byId('terminationReason');
    if(reasonEl) reasonEl.textContent=reason||'Suspicious activity detected.';
    if(modal) modal.hidden=false;

    // Capture/save the termination event BEFORE stopping the camera stream.
    // Stopping the stream first can make the final canvas frame completely black.
    await record('TEST_TERMINATED',{
      reason,
      lookingAwayWarnings:P.lookWarnings,
      summary:getSummary()
    },true,true);

    if(P.stream){
      P.stream.getTracks().forEach(t=>t.stop());
    }

    // quiz.js owns the actual test submission/result redirect.
    if(typeof window.finishTest==='function'){
      await window.finishTest(reason||'Suspicious activities detected');
    }else{
      location.href='/result';
    }
  }

  function onVisibility(){
    if(!isActive()) return;
    if(document.hidden){
      // visibilitychange + blur can fire together. The termination latch prevents duplicates.
      record('TAB_SWITCH',{message:'Tab switched away / window minimized'},true).then(()=>{
        terminate('Tab switched away / window minimized');
      });
    }
  }

  async function onBlur(){
    if(!isActive()) return;
    P.blurCount++;
    await record('WINDOW_BLUR',{
      count:P.blurCount,
      message:'Window lost focus / possible Alt+Tab'
    },true);
    uiWarning(`⚠ Window focus lost (${P.blurCount}/2 incidents). Return to the test window.`);
    if(P.blurCount >= 2){
      await terminate('Repeated window focus loss');
    }
  }


  // ---------- phone / study-material detection ----------
  // COCO-SSD is used for the same object-detection behaviour as the
  // standalone eye-detection reference project.  A confirmed cell phone
  // OR book/study-material detection immediately ends the test.
  const OBJECT_DETECT_INTERVAL_MS = 300;
  // COCO-SSD can return lower-confidence objects depending on camera angle,
  // lighting and object size. Keep the model's minimum low and apply our
  // own class-specific confirmation threshold below.
  const PHONE_SCORE_THRESHOLD = 0.42;
  const BOOK_SCORE_THRESHOLD = 0.38;
  const OBJECT_CONFIRM_HITS = 2;

  function getDetectedObject(predictions, classes, threshold){
    const wanted = Array.isArray(classes) ? classes : [classes];
    return predictions.find(p =>
      p &&
      wanted.includes(String(p.class || '').toLowerCase()) &&
      Number(p.score || 0) >= threshold
    ) || null;
  }

  async function processObjects(){
    // Prevent overlapping TensorFlow inference calls. With setInterval, a slow
    // inference could otherwise start a second inference before the first one
    // finished, making detection feel much slower.
    if(!isActive() || !P.objectModelReady || !P.objectModel || P.objectBusy) return;

    P.objectBusy=true;
    try{
      if(!P.video || P.video.readyState < 2 || !P.video.videoWidth) return;

      // Run COCO-SSD on a smaller working frame. This substantially reduces
      // inference time while retaining enough resolution for phone/book checks.
      if(!P.objectCanvas) P.objectCanvas=document.createElement('canvas');
      const maxWidth=480;
      const width=Math.min(P.video.videoWidth,maxWidth);
      const height=Math.max(1,Math.round(width*(P.video.videoHeight/P.video.videoWidth)));
      P.objectCanvas.width=width;
      P.objectCanvas.height=height;
      const ctx=P.objectCanvas.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(P.video,0,0,width,height);

      // Keep the candidate set small for faster inference.
      const predictions = await P.objectModel.detect(P.objectCanvas, 10, 0.20);
      const phone = getDetectedObject(predictions,['cell phone'],PHONE_SCORE_THRESHOLD);
      const book = getDetectedObject(predictions,['book'],BOOK_SCORE_THRESHOLD);

      if(phone) P.phoneStreak++;
      else P.phoneStreak=0;

      if(book) P.studyStreak++;
      else P.studyStreak=0;

      // Two consecutive detections (~0.9 sec minimum) reduce one-frame false positives.
      if(phone && P.phoneStreak>=OBJECT_CONFIRM_HITS && !P.phoneActive){
        P.phoneActive=true;
        await record('PHONE_DETECTED',{
          message:'Mobile phone detected in camera frame',
          confidence:Number((phone.score||0).toFixed(3))
        },false,false);
        await terminate('Mobile phone detected — test over');
        return;
      }

      if(book && P.studyStreak>=OBJECT_CONFIRM_HITS && !P.studyActive){
        P.studyActive=true;
        await record('STUDY_MATERIAL_DETECTED',{
          message:'Book / study material detected in camera frame',
          object:'book',
          confidence:Number((book.score||0).toFixed(3))
        },false,false);
        await terminate('Study material detected — test over');
        return;
      }
    }catch(e){
      console.warn('Object detection loop error',e);
    }finally{
      P.objectBusy=false;
    }
  }

  function eyeAspectRatio(pts){
    if(!pts || pts.length<6) return 1;
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    return (dist(pts[1],pts[5])+dist(pts[2],pts[4]))/(2*dist(pts[0],pts[3])+0.0001);
  }

  function analyseFace(face){
    const lm=face.landmarks;
    const left=lm.getLeftEye(), right=lm.getRightEye();
    const nose=lm.getNose();
    const jaw=lm.getJawOutline();
    const eyeL=left.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
    const eyeR=right.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
    eyeL.x/=left.length; eyeL.y/=left.length;
    eyeR.x/=right.length; eyeR.y/=right.length;

    const eyeCenterX=(eyeL.x+eyeR.x)/2;
    const eyeCenterY=(eyeL.y+eyeR.y)/2;
    const eyeWidth=Math.max(1,Math.abs(eyeR.x-eyeL.x));
    const noseTip=nose[3]||nose[Math.floor(nose.length/2)];

    // Normalized nose position relative to the eye line.
    const horizontal=(noseTip.x-eyeCenterX)/eyeWidth;
    const vertical=(noseTip.y-eyeCenterY)/eyeWidth;

    // With 68-point landmarks this is a practical head/gaze proxy, not iris-level gaze.
    const lookingAway=Math.abs(horizontal)>0.30 || vertical>0.82 || vertical<-0.58;
    const headTurn=Math.abs(horizontal)>0.38;
    const gazeDown=vertical>0.82;
    const ear=(eyeAspectRatio(left)+eyeAspectRatio(right))/2;
    const eyesClosed=ear<0.18;

    // Mouth aspect ratio (inner lips) - used to tell if the candidate's own lips are moving.
    try{
      const m=lm.getMouth();
      const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
      const mar=d(m[14],m[18])/(d(m[12],m[16])+0.0001);
      const t=Date.now();
      P.mouthSamples.push({t,mar});
      while(P.mouthSamples.length && t-P.mouthSamples[0].t>2500) P.mouthSamples.shift();
    }catch(e){}

    return {lookingAway,headTurn,gazeDown,eyesClosed,horizontal,vertical,ear};
  }

  async function process(){
    if(!isActive() || !P.modelReady || !window.faceapi) return;
    try{
      const detections=await faceapi.detectAllFaces(
        P.video,
        new faceapi.TinyFaceDetectorOptions({inputSize:320,minConfidence:.55})
      ).withFaceLandmarks();

      // Keep a recent valid camera frame in memory. This is intentionally
      // separate from event uploads so focus/tab changes can use the frame
      // captured immediately before the browser hides the video.
      if(P.video && P.video.readyState>=2 && P.video.videoWidth){
        const now=Date.now();
        if(now-P.lastSnapshotAt>=900){
          const frame=snapshot();
          if(frame){
            P.lastSnapshot=frame;
            P.lastSnapshotAt=now;
          }
        }
      }

      const count=detections.length;
      updateStats(count);

      if(count===0){
        if(P.noFaceStarted===null) P.noFaceStarted=Date.now();
        const absentMs = Date.now() - P.noFaceStarted;
        if(absentMs >= 3000 && !P.noFaceWarned){
          P.noFaceWarned = true;
          uiWarning('⚠ Face not detected. Please remain visible to the camera.');
          await record('NO_FACE_WARNING',{message:'Face not detected'},true);
        }
        if(absentMs >= 7000){
          await record('NO_FACE',{message:'Face not detected'},true);
          await terminate('Face not detected');
        }
        return;
      }
      if(P.noFaceStarted!==null){
        P.noFaceMs += Date.now()-P.noFaceStarted;
        P.noFaceStarted=null;
        P.noFaceWarned=false;
      }

      // Multiple faces terminate immediately.
      if(count>1){
        await record('MULTIPLE_FACES',{
          face_count:count,
          message:'Multiple faces detected'
        },true);
        await terminate('Multiple faces detected');
        return;
      }

      const a=analyseFace(detections[0]);

      if(a.lookingAway){
        if(!P.lookingEpisode){
          P.lookingEpisode=true;
          P.lookWarnings++;
          updateStats(count);
          uiWarning(`⚠ Suspicious activity detected — Candidate appears to be looking away (${P.lookWarnings}/2 warnings)`);

          await record('LOOKING_AWAY',{
            warning_number:P.lookWarnings,
            horizontal_ratio:Number(a.horizontal.toFixed(3)),
            vertical_ratio:Number(a.vertical.toFixed(3)),
            message:'Candidate appears to be looking away'
          },true);

          if(P.lookWarnings>=2){
            await terminate('Second looking-away incident detected');
            return;
          }
        }
      }else{
        P.lookingEpisode=false;
      }

      // Record eyes closed/head turned/gaze down as separate activity episodes.
      if(a.eyesClosed){
        if(!P.closedEpisode){
          P.closedEpisode=true;
          P.closedStarted=Date.now();
          await record('EYES_CLOSED',{ear:Number(a.ear.toFixed(3))},true);
        }
      }else{
        if(P.closedEpisode && P.closedStarted){
          P.events.push({event_type:'EYES_CLOSED_END',occurred_at:nowISO(),details:{duration_ms:Date.now()-P.closedStarted},snapshot:false});
        }
        P.closedEpisode=false; P.closedStarted=null;
      }

      if(a.headTurn){
        if(!P.headEpisode){
          P.headEpisode=true;
          P.lastHeadTurnAt=Date.now();
          await record('HEAD_TURNED',{
            horizontal_ratio:Number(a.horizontal.toFixed(3))
          },true);
        }
      }else P.headEpisode=false;
      if(a.headTurn) P.lastHeadTurnAt=Date.now();

      if(a.gazeDown){
        if(!P.downEpisode){
          P.downEpisode=true;
          await record('GAZE_DOWN',{
            vertical_ratio:Number(a.vertical.toFixed(3))
          },true);
        }
      }else P.downEpisode=false;

    }catch(e){
      console.warn('Face detection loop error',e);
    }
  }

  // ---------------- Voice / helper detection ----------------
  // Is the candidate's mouth moving? Looks only at the last `ms` of landmark samples.
  function lipsMoving(ms=2500){
    const t=Date.now();
    const s=P.mouthSamples.filter(x=>t-x.t<=ms);
    if(s.length<3) return null; // unknown (no face data)
    let lo=Infinity,hi=-Infinity;
    s.forEach(x=>{lo=Math.min(lo,x.mar);hi=Math.max(hi,x.mar);});
    return (hi-lo)>0.045;
  }

  // The app itself talks (question read-aloud) and listens (voice answer),
  // so those moments must not count as a helper's voice.
  function appIsSpeaking(){
    try{
      if(window.speechSynthesis && (speechSynthesis.speaking||speechSynthesis.pending)) P.appSpeechUntil=Date.now()+1500;
    }catch(e){}
    if(window.avitecVoiceAnswerActive) P.appSpeechUntil=Date.now()+1500;
    return Date.now()<P.appSpeechUntil;
  }

  const median=a=>{const s=a.slice().sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:-90;};

  function startVoiceMonitor(){
    try{
      if(P.audioCtx||!P.stream) return;
      const tracks=P.stream.getAudioTracks();
      if(!tracks.length) return;
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return;
      const ctx=new AC();
      if(ctx.resume) ctx.resume().catch(()=>{});
      const src=ctx.createMediaStreamSource(new MediaStream([tracks[0]]));
      const an=ctx.createAnalyser();
      an.fftSize=2048; an.smoothingTimeConstant=0;   // we do our own smoothing
      src.connect(an); // NOT connected to destination: no echo
      P.audioCtx=ctx;

      const spec=new Float32Array(an.frequencyBinCount);   // dB per bin
      const wave=new Float32Array(an.fftSize);
      const binHz=ctx.sampleRate/an.fftSize;
      const bin=hz=>Math.max(1,Math.round(hz/binHz));
      const sLo=bin(300), sHi=bin(3400), nyq=an.frequencyBinCount-1;

      P.voiceCalib=[]; P.voiceNoise=null; P.voiceFrames=[]; P.voiceActive=false;
      const calibStart=Date.now();
      let lastTick=performance.now();

      P.audioTimer=setInterval(async()=>{
        if(!isActive()) return;
        // Real elapsed time: browsers throttle timers in background tabs.
        const nowT=performance.now(); const dt=Math.min(nowT-lastTick,1000); lastTick=nowT;

        // ---- features for this frame ----
        an.getFloatTimeDomainData(wave);
        let sq=0,peak=0;
        for(let i=0;i<wave.length;i++){const v=wave[i];sq+=v*v;if(Math.abs(v)>peak)peak=Math.abs(v);}
        const rms=Math.sqrt(sq/wave.length)+1e-9;
        const levelDb=20*Math.log10(rms);                  // dBFS
        const crest=peak/rms;                               // high = click/impulse

        an.getFloatFrequencyData(spec);
        let tot=0,band=0,lg=0,n=0;
        for(let i=1;i<=nyq;i++){
          const p=Math.pow(10,spec[i]/10);
          tot+=p;
          if(i>=sLo&&i<=sHi){band+=p; lg+=Math.log(p+1e-20); n++;}
        }
        const bandRatio=band/Math.max(tot,1e-20);
        const flatness=n?Math.exp(lg/n)/(band/n+1e-20):1;   // geometric/arithmetic mean

        // ---- 1) calibrate room noise (median is robust to a cough during calibration) ----
        if(P.voiceNoise===null){
          P.voiceCalib.push(levelDb);
          if(Date.now()-calibStart>=VOICE_CALIBRATION_MS) P.voiceNoise=median(P.voiceCalib);
          return;
        }

        // ---- 2) ignore the app's own audio ----
        if(appIsSpeaking()){P.voiceFrames=[];P.voiceActive=false;return;}
        if(Date.now()<P.voiceCooldownUntil) return;

        // ---- 3) classify the frame (hysteresis: easier to stay voiced than to start) ----
        const margin=P.voiceActive?VOICE_OFF_DB:VOICE_ON_DB;
        const loudEnough=levelDb>P.voiceNoise+margin && levelDb>VOICE_MIN_ABS_DB;
        const speechLike=bandRatio>=VOICE_MIN_BAND_RATIO && flatness<=VOICE_MAX_FLATNESS && crest<9;
        const voiced=loudEnough && speechLike;
        P.voiceActive=voiced;

        // ---- 4) adaptive noise floor: follow the room (fans, AC) but never learn speech ----
        if(!voiced){
          const k=levelDb<P.voiceNoise?0.2:0.01;            // drop fast, rise slowly
          P.voiceNoise+=(levelDb-P.voiceNoise)*k;
        }

        // ---- 5) sliding window ----
        const t=Date.now();
        P.voiceFrames.push({t,dt,voiced,levelDb,lips:lipsMoving(700)});
        while(P.voiceFrames.length && t-P.voiceFrames[0].t>VOICE_WINDOW_MS) P.voiceFrames.shift();

        const vf=P.voiceFrames.filter(f=>f.voiced);
        const speechMs=vf.reduce((a,f)=>a+f.dt,0);
        if(speechMs<VOICE_MIN_SPEECH_MS) return;

        // Speech has a fluctuating envelope; steady hum/tone/fan does not.
        const mean=vf.reduce((a,f)=>a+f.levelDb,0)/vf.length;
        const std=Math.sqrt(vf.reduce((a,f)=>a+(f.levelDb-mean)**2,0)/vf.length);
        if(std<VOICE_MIN_ENV_STD_DB) return;

        // ---- 6) incident: whose voice? compare voiced frames with candidate's lip movement ----
        const known=vf.filter(f=>f.lips!==null);
        const lipFrac=known.length>=3?known.filter(f=>f.lips).length/known.length:null;
        const otherVoice=(lipFrac!==null && lipFrac<=VOICE_OTHER_LIPS_FRAC);
        const ownVoice=(lipFrac!==null && lipFrac>=VOICE_OWN_LIPS_FRAC);
        const withHead=(t-P.lastHeadTurnAt)<10000;
        // Every detected voice episode counts as exactly ONE warning.
        // The 1st and 2nd incidents warn the candidate; the 3rd terminates the test.
        // Head-turn / non-moving-lips signals affect classification only, not warning count.
        P.voiceFrames=[]; P.voiceActive=false;
        P.voiceCooldownUntil=t+VOICE_COOLDOWN_MS;
        P.voiceWarnings+=1;
        if(P.voiceWarnings < VOICE_MAX_WARNINGS){
          uiWarning(`⚠ Voice detected — talking or outside help is not allowed (${P.voiceWarnings}/2 warnings)`);
        }
        await record('VOICE_DETECTED',{
          warning_number:P.voiceWarnings,
          incident_number:P.voiceWarnings,
          with_head_turn:withHead,
          lips_moving:lipFrac===null?null:lipFrac>=VOICE_OWN_LIPS_FRAC,
          lips_fraction:lipFrac===null?null:Number(lipFrac.toFixed(2)),
          likely_other_person:otherVoice,
          likely_candidate:ownVoice,
          speech_ms:Math.round(speechMs),
          level_db:Number(mean.toFixed(1)),
          noise_floor_db:Number(P.voiceNoise.toFixed(1)),
          envelope_std_db:Number(std.toFixed(1)),
          message:otherVoice?'Voice detected while candidate lips not moving (possible helper)':'Sustained voice detected during test'
        },true);
        if(VOICE_MAX_WARNINGS>0 && P.voiceWarnings>=VOICE_MAX_WARNINGS){
          await terminate('Third voice / outside help incident detected');
        }
      },VOICE_FRAME_MS);
    }catch(e){ console.warn('Voice monitor unavailable',e); }
  }

  function stopVoiceMonitor(){
    clearInterval(P.audioTimer); P.audioTimer=null;
    try{ if(P.audioCtx) P.audioCtx.close(); }catch(e){}
    P.audioCtx=null; P.voiceFrames=[]; P.voiceActive=false;
  }

  function getSummary(){
    let noFace=P.noFaceMs;
    if(P.noFaceStarted!==null) noFace += Date.now()-P.noFaceStarted;
    return {
      lookingAwayWarnings:P.lookWarnings,
      noFaceDurationMs:noFace,
      eventCount:P.events.length,
      tabFocusIncidents:P.events.filter(e=>['TAB_SWITCH','WINDOW_BLUR'].includes(e.event_type)).length,
      multipleFaceEvents:P.events.filter(e=>e.event_type==='MULTIPLE_FACES').length,
      lookingAwayEvents:P.events.filter(e=>e.event_type==='LOOKING_AWAY').length,
      eyesClosedEvents:P.events.filter(e=>e.event_type==='EYES_CLOSED').length,
      headTurnedEvents:P.events.filter(e=>e.event_type==='HEAD_TURNED').length,
      gazeDownEvents:P.events.filter(e=>e.event_type==='GAZE_DOWN').length,
      voiceDetectedEvents:P.events.filter(e=>e.event_type==='VOICE_DETECTED').length,
      phoneDetectedEvents:P.events.filter(e=>e.event_type==='PHONE_DETECTED').length,
      studyMaterialDetectedEvents:P.events.filter(e=>e.event_type==='STUDY_MATERIAL_DETECTED').length
    };
  }

  // COCO-SSD is loaded from the browser cache/CDN and warmed up in the background.
  // A local model is optional; the exam must not fail just because a local
  // model.json file is not bundled with the deployment.
  const OBJECT_MODEL_LOAD_ATTEMPTS = 2;
  const OBJECT_MODEL_RETRY_DELAY_MS = 1200;

  const sleep=ms=>new Promise(res=>setTimeout(res,ms));
  let objectModelWarmup=null;

  function beginObjectModelWarmup(){
    if(objectModelWarmup) return objectModelWarmup;
    objectModelWarmup=(async()=>{
      if(typeof tf==='undefined' || typeof cocoSsd==='undefined'){
        throw new Error('TensorFlow.js / COCO-SSD scripts are not available.');
      }
      await tf.ready();
      // Lite MobileNet v2 is the faster COCO-SSD model and is sufficient for
      // the cell-phone class used by proctoring.
      return await cocoSsd.load({base:'lite_mobilenet_v2'});
    })();
    return objectModelWarmup;
  }

  async function loadObjectDetectionModel(attempt=1){
    try{
      // Start downloading as early as possible; by the time the candidate
      // reaches the test this is often already cached/warmed up.
      P.objectModel = await beginObjectModelWarmup();
      P.objectModelReady = !!P.objectModel;

      if(P.objectModelReady){
        if(P.status) P.status.textContent='Camera active • Object detection active';
        setObjectBadge('ok','');
        clearInterval(P.objectTimer);
        P.objectTimer=setInterval(processObjects,OBJECT_DETECT_INTERVAL_MS);
        processObjects();
      }
    }catch(e){
      console.error(`Object-detection model failed to load (attempt ${attempt}/${OBJECT_MODEL_LOAD_ATTEMPTS}):`,e);
      objectModelWarmup=null;
      if(attempt<OBJECT_MODEL_LOAD_ATTEMPTS && isActive()){
        if(P.status) P.status.textContent=`Camera active • Retrying object detection (${attempt}/${OBJECT_MODEL_LOAD_ATTEMPTS})…`;
        await sleep(OBJECT_MODEL_RETRY_DELAY_MS);
        return loadObjectDetectionModel(attempt+1);
      }
      P.objectModelReady=false;
      P.objectModel=null;
      if(P.status) P.status.textContent='Camera active • Object detection unavailable';
      setObjectBadge('error','⚠ Phone/notes detection unavailable — eye tracking only');
      await record('OBJECT_DETECTION_UNAVAILABLE',{
        message:'Phone/study-material detector failed to load after retries',
        attempts:OBJECT_MODEL_LOAD_ATTEMPTS
      },false);
    }
  }

  // Do not warm up TensorFlow/COCO-SSD while the candidate is on the
  // camera/microphone permission screen. Model initialization can compete
  // with the browser permission prompt on slower machines. It starts after
  // permissions have been granted instead.

  function ensurePermissionOverlay(){
    let overlay=document.getElementById('proctorPermissionOverlay');
    if(overlay) return overlay;

    overlay=document.createElement('div');
    overlay.id='proctorPermissionOverlay';
    overlay.innerHTML=`
      <div class="proctor-permission-card">
        <div class="proctor-permission-icon">🔐</div>
        <h2>Camera & Microphone Required</h2>
        <p>This test cannot begin until you allow both <b>Camera</b> and <b>Microphone</b> access.</p>
        <p class="proctor-permission-note">Your camera is used for proctoring and the microphone is required for the test's voice features.</p>
        <button type="button" id="proctorPermissionBtn">Allow Camera & Microphone</button>
        <div id="proctorPermissionStatus" class="proctor-permission-status"></div>
      </div>`;
    const style=document.createElement('style');
    style.textContent=`
      #proctorPermissionOverlay{position:fixed;inset:0;background:rgba(8,12,24,.92);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px}
      .proctor-permission-card{width:min(520px,100%);background:#fff;border-radius:22px;padding:34px 30px;text-align:center;box-shadow:0 25px 80px rgba(0,0,0,.45);font-family:Arial,sans-serif}
      .proctor-permission-icon{font-size:42px;margin-bottom:8px}.proctor-permission-card h2{margin:0 0 12px;color:#111827;font-size:25px}
      .proctor-permission-card p{color:#4b5563;line-height:1.55;margin:8px 0}.proctor-permission-note{font-size:13px}
      #proctorPermissionBtn{border:0;border-radius:12px;padding:13px 22px;margin-top:16px;background:#2563eb;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
      #proctorPermissionBtn:disabled{opacity:.65;cursor:not-allowed}.proctor-permission-status{min-height:22px;margin-top:14px;color:#b91c1c;font-size:13px}
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    return overlay;
  }

  async function requestProctoringPermissions(){
    if(P.permissionsGranted && P.permissionStream) return true;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      throw new Error('Camera and microphone APIs are not available in this browser. Use HTTPS and allow access in browser settings.');
    }

    const overlay=ensurePermissionOverlay();
    const btn=overlay.querySelector('#proctorPermissionBtn');
    const status=overlay.querySelector('#proctorPermissionStatus');
    if(P.permissionPromise) return P.permissionPromise;

    let resolveRequest;
    P.permissionPromise=new Promise(resolve=>{ resolveRequest=resolve; });
    btn.dataset.permissionHandlerAttached='1';
    let busy=false;

    btn.onclick=async()=>{
      // Ignore rapid/double clicks while the browser or server is responding.
      if(busy) return;
      busy=true;
      btn.disabled=true;
      status.textContent=P.permissionStream
        ? 'Camera and microphone allowed. Confirming secure test access…'
        : 'Waiting for camera and microphone access…';
      status.style.color='#4b5563';
      try{
        // If media access already succeeded but the server request was slow,
        // keep the stream and retry only the lightweight server confirmation.
        if(!P.permissionStream){
          P.permissionStream=await navigator.mediaDevices.getUserMedia({
            video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},
            audio:true
          });
        }

        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),8000);
        let response;
        try{
          response=await fetch('/api/proctor/permissions',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({camera:true,microphone:true}),
            signal:controller.signal
          });
        }finally{ clearTimeout(timeout); }
        const data=await response.json().catch(()=>({}));
        if(!response.ok || !data.ok){
          throw new Error(data.error||`Server confirmation failed (${response.status}).`);
        }

        P.permissionsGranted=true;
        status.textContent='Access granted. Preparing your test…';
        overlay.remove();
        resolveRequest(true);
        P.permissionPromise=null;
        // Start the heavier object model only after the permission prompt has
        // finished so it cannot make the Allow button feel frozen.
        setTimeout(()=>{ beginObjectModelWarmup().catch(()=>{}); },250);
      }catch(err){
        // Preserve an already-open stream for server retries; only clear it
        // when the browser itself failed to grant media access.
        const browserPermissionFailure=!P.permissionStream;
        if(browserPermissionFailure){
          P.permissionsGranted=false;
        }
        btn.disabled=false;
        busy=false;
        status.style.color='#b91c1c';
        if(err && err.name==='NotAllowedError'){
          status.textContent='Permission was blocked. Choose Allow in the browser prompt, then click here again.';
        }else if(err && err.name==='NotFoundError'){
          status.textContent='Camera or microphone not found. Connect/enable both devices and try again.';
        }else if(err && err.name==='AbortError'){
          status.textContent='Server is taking too long. Click again to retry without asking for camera access again.';
        }else{
          status.textContent='Could not confirm access. Click again to retry. ('+String(err.message||'Unknown error')+')';
        }
        // Keep the promise pending so the same button can recover on retry.
      }
    };
    return P.permissionPromise;
  }

  async function start(attemptId){
    if(P.running) return;
    P.attemptId=attemptId||null;
    P.video=byId('proctorVideo');
    P.status=byId('proctorStatus');
    P.warning=byId('proctorWarning');
    P.faceCount=byId('faceCount');
    P.lookCount=byId('lookCount');
    P.objectBadge=byId('objectDetectionBadge');
    if(!P.video) return;

    try{
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        throw new Error('Camera API is not available in this browser.');
      }

      if(P.status) P.status.textContent='Starting camera…';

      // Start the camera first, then load all mandatory proctoring models.
      if(!P.permissionsGranted || !P.permissionStream){
        throw new Error('Camera and microphone permissions are required before the test can start.');
      }
      P.stream=P.permissionStream;
      P.permissionStream=null;
      P.video.srcObject=P.stream;
      await P.video.play();

      P.running=true;
      P.lastSnapshot=null;
      P.lastSnapshotAt=0;
      document.addEventListener('visibilitychange',onVisibility);
      window.addEventListener('blur',onBlur);

      // Face models are local to this project and are the critical eye/head
      // proctoring path. Load them without waiting for COCO-SSD.
      if(P.status) P.status.textContent='Camera active • Loading eye detection…';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/static/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/static/models')
      ]);
      P.modelReady=true;

      if(P.status) P.status.textContent='Camera active • Eye detection active';
      await record('PROCTORING_STARTED',{message:'Camera and proctoring started'},false);

      P.timer=setInterval(process,650);
      process();
      startVoiceMonitor();

      // Object detection is mandatory. Do not allow the exam to continue
      // until the self-hosted phone/study-material model is loaded and ready.
      if(P.status) P.status.textContent='Camera active • Loading required object detection…';
      await loadObjectDetectionModel();
      return true;
    }catch(e){
      console.error('Proctoring start failed',e);
      P.running=false;
      stopVoiceMonitor();
      clearInterval(P.timer);
      clearInterval(P.objectTimer);
      P.timer=null;
      P.objectTimer=null;
      if(P.stream) P.stream.getTracks().forEach(t=>t.stop());
      P.stream=null;
      if(P.status) P.status.textContent='Proctoring could not start — test blocked';
      uiWarning(`⚠ ${String(e.message||'Required proctoring model could not be loaded.')}`);
      await record('CAMERA_ERROR',{message:String(e.message||e)},false);
      return false;
    }
  }

  window.requestProctoringPermissions=requestProctoringPermissions;
  window.startProctoring=start;
  window.stopProctoring=()=>{P.running=false;stopVoiceMonitor();clearInterval(P.timer);clearInterval(P.objectTimer);P.objectTimer=null;if(P.stream)P.stream.getTracks().forEach(t=>t.stop());};
  window.getProctoringSummary=getSummary;
  window.getProctoringEvents=()=>P.events.slice();

  window.addEventListener('beforeunload',()=>{
    if(P.stream) P.stream.getTracks().forEach(t=>t.stop());
  });
})();
