const AVITECH_IT_SUBJECTS = ['HTML', 'CSS', 'JavaScript', 'Bootstrap', 'Tailwind', 'React', 'Vanilla JS', 'Python', 'Java', 'C', 'C++', 'C#', '.NET', 'PHP', 'Node.js', 'MySQL', 'MongoDB', 'Git', 'Oracle', 'Excel', 'Advanced Excel', 'Power BI', 'Tally', 'VBA', 'Digital Marketing', 'BSS'];
// ============================================================
// AVITECH AI - MAIN SCRIPT
// ============================================================

let category = "";
let questions = [];
let index = 0;
let answers = [];
let submitted = false;
let streak = 0;
let score = 0;
let testStartTime = null;

let recognition = null;
let listening = false;
let voiceReady = false;


// ============================================================
// SHORT ID FUNCTION
// ============================================================

const $ = id => document.getElementById(id);


// ============================================================
// SCREEN SHOW FUNCTION
// ============================================================

function show(id) {

    document
        .querySelectorAll(".screen")
        .forEach(screen => {
            screen.classList.remove("active");
        });

    const target = $(id);

    if (target) {
        target.classList.add("active");
    }
}


// ============================================================
// HOME
// ============================================================

function home() {

    try {
        speechSynthesis.cancel();
    } catch (e) {}

    document.body.className = "";

    if ($("homeMessage")) {
        $("homeMessage").textContent =
            "Hello! I'm your AVITECH AI. I can talk, listen, react and guide you through your test.";
    }

    if ($("homeSpeech")) {
        $("homeSpeech").textContent =
            "Hi! I'm ready when you are.";
    }

    show("home");

    setTimeout(() => {

        speak("Welcome to AVITECH AI.");

    }, 300);
}


// ============================================================
// SHOW CATEGORY PAGE
// ============================================================

function showCategories() {

    voiceReady = true;

    try {
        speechSynthesis.cancel();
    } catch (e) {}

    show("categories");

    setTimeout(() => {

        speak(
            "Great! Choose your test track. AVITECH IT or AVITECH Aviation."
        );

    }, 120);
}


// ============================================================
// OPEN AVIATION TOPICS PAGE
// ============================================================

function openAviationTopics() {
    window.location.href = "/aviation-topic";
}


// ============================================================
// START QUIZ
// ============================================================

async function startQuiz(cat) {

    // --------------------------------------------------------
    // Reset everything
    // --------------------------------------------------------

    category = cat;

    index = 0;

    answers = [];

    submitted = false;

    streak = 0;

    score = 0;

    testStartTime = Date.now();


    // --------------------------------------------------------
    // Show quiz screen
    // --------------------------------------------------------

    show("quiz");


    // --------------------------------------------------------
    // Quiz heading
    // --------------------------------------------------------

    if ($("quizTitle")) {

        $("quizTitle").textContent =
            cat === "it"
                ? "AVITECH IT"
                : "AVITECH Aviation";

    }


    if ($("topicName")) {

        $("topicName").textContent =
            cat === "it"
                ? "Technology"
                : "Aviation";

    }


    // --------------------------------------------------------
    // Reset score
    // --------------------------------------------------------

    if ($("liveScore")) {
        $("liveScore").textContent = "0";
    }

    if ($("streak")) {
        $("streak").textContent = "0";
    }

    if ($("progressBar")) {
        $("progressBar").style.width = "5%";
    }


    // --------------------------------------------------------
    // Robot message
    // --------------------------------------------------------

    if ($("robotTalk")) {

        $("robotTalk").textContent =
            "I'm getting your first question ready...";

    }


    document.body.className = "thinking";


    // --------------------------------------------------------
    // Get questions from Flask
    // --------------------------------------------------------

    try {

        const response =
            await fetch("/api/questions/" + cat);


        if (!response.ok) {

            throw new Error(
                "Unable to load questions"
            );

        }


        questions =
            (await response.json()).slice(0, 15);


        // ----------------------------------------------------
        // Total questions
        // ----------------------------------------------------

        if ($("totalQuestions")) {

            $("totalQuestions").textContent =
                questions.length;

        }


        // ----------------------------------------------------
        // No questions protection
        // ----------------------------------------------------

        if (!questions.length) {

            if ($("questionText")) {

                $("questionText").textContent =
                    "No questions found.";

            }

            return;
        }


        // ----------------------------------------------------
        // Render first question
        // ----------------------------------------------------

        renderQuestion();


    } catch (error) {

        console.error(error);

        if ($("questionText")) {

            $("questionText").textContent =
                "Unable to load questions. Start the Flask server and try again.";

        }

    }
}


// ============================================================
// RENDER QUESTION
// ============================================================

function renderQuestion() {

    submitted = false;


    // --------------------------------------------------------
    // Feedback reset
    // --------------------------------------------------------

    if ($("feedbackEmpty")) {

        $("feedbackEmpty").style.display =
            "block";

    }


    document.body.className = "";


    // --------------------------------------------------------
    // Current question
    // --------------------------------------------------------

    const q = questions[index];


    if (!q) {
        return;
    }


    // --------------------------------------------------------
    // Question number
    // --------------------------------------------------------

    if ($("questionNumber")) {

        $("questionNumber").textContent =
            String(index + 1).padStart(2, "0");

    }


    if ($("qIndex")) {

        $("qIndex").textContent =
            String(index + 1).padStart(2, "0");

    }


    // --------------------------------------------------------
    // Question text
    // --------------------------------------------------------

    if ($("questionText")) {

        $("questionText").textContent =
            q.q;

    }


    // --------------------------------------------------------
    // Progress
    // --------------------------------------------------------

    if ($("progressBar")) {

        const progress =
            ((index + 1) / questions.length) * 100;

        $("progressBar").style.width =
            progress + "%";

    }


    // --------------------------------------------------------
    // Feedback
    // --------------------------------------------------------

    if ($("answerFeedback")) {

        $("answerFeedback").className =
            "answerFeedback";

        $("answerFeedback").innerHTML =
            "";

    }


    // --------------------------------------------------------
    // Buttons
    // --------------------------------------------------------

    if ($("nextBtn")) {

        $("nextBtn").disabled = true;

    }


    if ($("showAnswerBtn")) {

        $("showAnswerBtn").disabled = false;

    }


    if ($("listenBtn")) {

        $("listenBtn").disabled = false;

    }


    // --------------------------------------------------------
    // Robot
    // --------------------------------------------------------

    if ($("robotTalk")) {

        $("robotTalk").textContent =
            "I'm listening... choose an answer.";

        $("robotTalk").style.color = "";

    }


    // --------------------------------------------------------
    // Options
    // --------------------------------------------------------

    const box = $("options");


    if (!box) {
        return;
    }


    box.innerHTML = "";


    q.o.forEach((option, i) => {

        const label =
            document.createElement("label");


        label.className =
            "option";


        label.innerHTML = `

            <input
                type="radio"
                name="answer"
                value="${i}"
            >

            <span class="radio"></span>

            <span>
                <b>${String.fromCharCode(65 + i)}.</b>
                ${escapeHtml(option)}
            </span>

        `;


        label.addEventListener(
            "click",
            () => selectOption(i)
        );


        box.appendChild(label);

    });


    // --------------------------------------------------------
    // Speak question
    // --------------------------------------------------------

    speakCurrentQuestion();
}


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(value) {

    return String(value).replace(
        /[&<>'"]/g,
        character => {

            return {

                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "'": "&#39;",
                '"': "&quot;"

            }[character];

        }
    );
}


// ============================================================
// SELECT OPTION
// ============================================================

function selectOption(i) {

    if (submitted) {
        return;
    }


    document
        .querySelectorAll(".option")
        .forEach((option, k) => {

            option.classList.toggle(
                "selected",
                k === i
            );

        });


    answers[index] = i;


    submitAnswer(i);
}


// ============================================================
// SUBMIT ANSWER
// ============================================================

function submitAnswer(i) {

    if (submitted) {
        return;
    }


    submitted = true;


    const q =
        questions[index];


    const correct =
        i === q.a;


    // --------------------------------------------------------
    // Score
    // --------------------------------------------------------

    if (correct) {

        score++;

        streak++;

    } else {

        streak = 0;

    }


    // --------------------------------------------------------
    // Update score
    // --------------------------------------------------------

    if ($("liveScore")) {

        $("liveScore").textContent =
            score;

    }


    if ($("streak")) {

        $("streak").textContent =
            streak;

    }


    // --------------------------------------------------------
    // Highlight answers
    // --------------------------------------------------------

    document
        .querySelectorAll(".option")
        .forEach((option, k) => {

            option.classList.remove(
                "selected"
            );


            if (k === q.a) {

                option.classList.add(
                    "correct"
                );

            }


            if (
                k === i &&
                !correct
            ) {

                option.classList.add(
                    "wrong"
                );

            }

        });


    // --------------------------------------------------------
    // Feedback
    // --------------------------------------------------------

    const feedback =
        $("answerFeedback");


    if ($("feedbackEmpty")) {

        $("feedbackEmpty").style.display =
            "none";

    }


    if (feedback) {

        feedback.className =
            "answerFeedback show " +
            (correct ? "correct" : "wrong");


        feedback.innerHTML = `

            <div class="feedbackTitle">

                ${
                    correct
                        ? "✓ CORRECT ANSWER"
                        : "✕ INCORRECT ANSWER"
                }

            </div>


            <div class="feedbackLine">

                <b>Correct answer:</b>

                ${String.fromCharCode(65 + q.a)}
                —
                ${escapeHtml(q.o[q.a])}

            </div>


            ${
                !correct
                    ? `
                        <div class="feedbackLine">

                            <b>Your answer:</b>

                            ${String.fromCharCode(65 + i)}
                            —
                            ${escapeHtml(q.o[i])}

                        </div>
                    `
                    : ""
            }


            <div class="feedbackExplanation">

                <b>Explanation:</b>

                ${escapeHtml(q.explanation || "")}

            </div>

        `;

    }


    // --------------------------------------------------------
    // Next button
    // --------------------------------------------------------

    if ($("nextBtn")) {

        $("nextBtn").disabled = false;

    }


    // --------------------------------------------------------
    // Show answer button
    // --------------------------------------------------------

    if ($("showAnswerBtn")) {

        $("showAnswerBtn").disabled = true;

    }


    // --------------------------------------------------------
    // Listen button
    // --------------------------------------------------------

    if ($("listenBtn")) {

        $("listenBtn").disabled = true;

    }


    // --------------------------------------------------------
    // Scroll
    // --------------------------------------------------------

    if ($("nextBtn")) {

        $("nextBtn").scrollIntoView({

            block: "nearest",

            behavior: "smooth"

        });

    }


    // --------------------------------------------------------
    // Robot
    // --------------------------------------------------------

    if ($("robotTalk")) {

        $("robotTalk").textContent =
            correct
                ? "Excellent! That is correct."
                : "Not quite. Let me explain the correct answer.";

    }


    document.body.className =
        correct
            ? "correct"
            : "wrong";


    // --------------------------------------------------------
    // Voice feedback
    // --------------------------------------------------------

    if (correct) {

        speak(
            "Correct! Great job. " +
            q.explanation
        );

    } else {

        speak(
            "Incorrect. The correct answer is " +
            String.fromCharCode(65 + q.a) +
            ". " +
            q.explanation
        );

    }
}


// ============================================================
// SHOW ANSWER
// ============================================================

function showAnswer() {

    if (submitted) {
        return;
    }


    const empty =
        $("feedbackEmpty");


    if (empty) {

        empty.style.display =
            "none";

    }


    const q =
        questions[index];


    document
        .querySelectorAll(".option")
        .forEach((option, k) => {

            if (k === q.a) {

                option.classList.add(
                    "correct"
                );

            }

        });


    if ($("robotTalk")) {

        $("robotTalk").textContent =
            "Here's the correct answer. Listen to the explanation.";

    }


    speak(

        "The correct answer is " +

        String.fromCharCode(65 + q.a) +

        ". " +

        q.o[q.a] +

        ". " +

        q.explanation

    );
}


// ============================================================
// NEXT QUESTION
// ============================================================

function nextQuestion() {

    if (!submitted) {
        return;
    }


    index++;


    if (index < questions.length) {

        renderQuestion();

    } else {

        finishQuiz();

    }
}


// ============================================================
// FINISH QUIZ
// ============================================================

async function finishQuiz() {
    const timeTaken = formatTimeTaken(testStartTime ? Date.now() - testStartTime : 0);
    let data;

    try {
        const response = await fetch("/api/score", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category, answers: answers.slice(0, 15) })
        });
        if (!response.ok) throw new Error("Score request failed");
        data = await response.json();
    } catch (error) {
        console.error(error);
        data = {
            score,
            total: 15,
            details: questions.slice(0, 15).map((q, i) => ({
                question: q.q,
                selected: answers[i] ?? null,
                correct: q.a,
                correctAnswer: q.o[q.a],
                explanation: q.explanation || "",
                isCorrect: answers[i] === q.a
            }))
        };
    }

    const details = (data.details || []).slice(0, 15);
    const report = {
        technology: category === "it" ? "AVITECH IT" : "AVITECH Aviation",
        score: Number(data.score) || 0,
        total: 15,
        timeTaken,
        topics: buildTopicReport(details),
        questions: details.map(d => {
            const q = questions.find(item => item.q === d.question);
            const selected = d.selected;
            return {
                question: d.question,
                chosenAnswer: selected === null || selected === undefined || selected < 0
                    ? "Not Answered"
                    : (q && q.o[selected]) || "Not Answered",
                rightAnswer: d.correctAnswer,
                isCorrect: !!d.isCorrect
            };
        })
    };

    localStorage.setItem("quizResult", JSON.stringify(report));
    window.location.href = "/result";
}

function formatTimeTaken(ms) {
    if (!ms || ms < 1000) return "0 sec";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return minutes ? `${minutes} min ${remaining} sec` : `${remaining} sec`;
}

function buildTopicReport(details) {
    const groups = [
        { name: "HTML & Web", match: /HTML|CSS|HTTP|REST|URL|URI|web/i },
        { name: "Python & Programming", match: /Python|function|dictionary|list|exception|Big-O|virtual environment/i },
        { name: "JavaScript", match: /JavaScript|javascript|array|filter|let|const/i },
        { name: "SQL & Databases", match: /SQL|database|JOIN|B-tree|index/i },
        { name: "Git & Development", match: /Git|branch|dependencies|DNS/i }
    ];
    const buckets = groups.map(g => ({ ...g, total: 0, correct: 0 }));
    details.forEach(d => {
        const group = buckets.find(g => g.match.test(d.question)) || buckets[1];
        group.total++;
        if (d.isCorrect) group.correct++;
    });
    return buckets.filter(g => g.total).map(g => ({
        name: g.name,
        total: g.total,
        correct: g.correct,
        score: Math.round(g.correct / g.total * 100)
    }));
}

function speakCurrentQuestion() {

    if (!questions[index]) {
        return;
    }


    const q =
        questions[index];


    speak(

        `Question ${index + 1}. ` +

        q.q +

        `. Option A: ${q.o[0]}. ` +

        `Option B: ${q.o[1]}. ` +

        `Option C: ${q.o[2]}. ` +

        `Option D: ${q.o[3]}.`

    );
}


// ============================================================
// TEXT TO SPEECH
// ============================================================

function speak(text) {

    if (!("speechSynthesis" in window)) {
        return;
    }


    try {

        voiceReady = true;


        speechSynthesis.cancel();


        text =
            String(text)
                ;


        const utterance =
            new SpeechSynthesisUtterance(text);


        utterance.lang =
            "en-IN";


        utterance.rate =
            0.92;


        utterance.pitch =
            1.03;


        utterance.onstart = () => {

            document.body.classList.add(
                "speaking"
            );


            if ($("robotTalk")) {

                $("robotTalk").textContent =
                    "Speaking...";

            }

        };


        utterance.onend = () => {

            document.body.classList.remove(
                "speaking"
            );


            if (
                $("robotTalk") &&
                questions[index] &&
                !submitted
            ) {

                $("robotTalk").textContent =
                    "I'm listening... choose an answer.";

            }

        };


        speechSynthesis.speak(
            utterance
        );


    } catch (error) {

        console.error(error);

    }
}


// ============================================================
// VOICE LISTENING UI
// ============================================================

function setListening(active) {

    listening = active;


    const listenButton =
        $("listenBtn");


    const micButton =
        $("micBtn");


    if (listenButton) {

        listenButton.classList.toggle(
            "listening",
            active
        );


        listenButton.textContent =
            active
                ? "🎙 LISTENING..."
                : "🎙 ANSWER BY VOICE";

    }


    if (micButton) {

        micButton.classList.toggle(
            "listening",
            active
        );

    }


    if (active) {

        document.body.classList.add(
            "speaking"
        );


        if ($("robotTalk")) {

            $("robotTalk").textContent =
                "I'm listening... say A, B, C or D.";

        }

    } else {

        document.body.classList.remove(
            "speaking"
        );

    }
}


// ============================================================
// GET VOICE OPTION
// ============================================================

function getVoiceOption(text) {

    text =
        text
            .toLowerCase()
            .replace(/[.,!?]/g, " ");


    if (
        /\b(a|ay|alpha|first|option a|answer a)\b/
            .test(text)
    ) {

        return 0;

    }


    if (
        /\b(b|bee|bravo|second|option b|answer b)\b/
            .test(text)
    ) {

        return 1;

    }


    if (
        /\b(c|see|charlie|third|option c|answer c)\b/
            .test(text)
    ) {

        return 2;

    }


    if (
        /\b(d|dee|delta|fourth|option d|answer d)\b/
            .test(text)
    ) {

        return 3;

    }


    return -1;
}


// ============================================================
// START VOICE ANSWER
// ============================================================

function startVoiceAnswer() {

    if (submitted) {
        return;
    }


    const SR =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;


    if (!SR) {

        alert(
            "Voice input works best in Google Chrome or Microsoft Edge."
        );

        return;
    }


    if (listening) {

        stopVoiceAnswer();

        return;

    }


    try {

        speechSynthesis.cancel();


        recognition =
            new SR();


        recognition.lang =
            "en-IN";


        recognition.continuous =
            false;


        recognition.interimResults =
            false;


        recognition.maxAlternatives =
            5;


        setListening(true);


        recognition.start();


        recognition.onresult =
            event => {

                let selected =
                    -1;


                for (
                    let i = 0;
                    i < event.results[0].length;
                    i++
                ) {

                    selected =
                        getVoiceOption(
                            event
                                .results[0][i]
                                .transcript
                        );


                    if (selected >= 0) {
                        break;
                    }

                }


                setListening(false);


                if (selected >= 0) {

                    selectOption(
                        selected
                    );

                } else {

                    if ($("robotTalk")) {

                        $("robotTalk").textContent =
                            "I heard you, but please say option A, B, C or D.";

                    }


                    speak(
                        "Please say option A, B, C or D."
                    );

                }

            };


        recognition.onerror =
            () => {

                setListening(false);

            };


        recognition.onend =
            () => {

                setListening(false);

            };


    } catch (error) {

        console.error(error);

        setListening(false);

    }
}


// ============================================================
// STOP VOICE ANSWER
// ============================================================

function stopVoiceAnswer() {

    try {

        if (recognition) {

            recognition.stop();

        }

    } catch (error) {}


    setListening(false);
}


// ============================================================
// ROBOT MOUSE MOVEMENT
// ============================================================

window.addEventListener(
    "mousemove",
    event => {

        const robot =
            $("heroRobot");


        const homeScreen =
            $("home");


        if (
            !robot ||
            !homeScreen ||
            !homeScreen.classList.contains("active")
        ) {

            return;

        }


        const x =
            (
                event.clientX /
                window.innerWidth -
                0.5
            ) * 8;


        const y =
            (
                event.clientY /
                window.innerHeight -
                0.5
            ) * 5;


        robot.style.transform =
            `translate(${x}px, ${y}px)`;

    }
);


// ============================================================
// IMPORTANT:
// AVITECH IT TOPIC PAGE -> START TEST
// ============================================================
//
// it.html se:
//
//     /?start=it
//
// open hoga.
//
// Ye automatically AVITECH IT ka quiz start karega.
// ============================================================

window.addEventListener(
    "load",
    () => {

        const params =
            new URLSearchParams(
                window.location.search
            );


        const start =
            params.get("start");


        // ----------------------------------------------------
        // TESTING MODE
        // ----------------------------------------------------

        if (start === "it" || start === "aviation") {
            // Legacy links must open the current hard quiz interface, not the old embedded quiz.
            window.location.replace("/quiz?bank=" + encodeURIComponent(start));
            return;
        }


        // ----------------------------------------------------
        // AFTER QUIZ INSTRUCTIONS
        // ----------------------------------------------------

        if (params.get("show") === "categories") {

            voiceReady = true;

            setTimeout(
                () => {
                    showCategories();
                },
                200
            );

            return;

        }


        // ----------------------------------------------------
        // NORMAL HOME PAGE
        // ----------------------------------------------------

        setTimeout(
            () => {

                speak(
                    "Welcome to AVITECH AI."
                );

            },
            700
        );

    }
);


// ============================================================
// FIRST USER CLICK VOICE
// ============================================================

window.addEventListener(
    "pointerdown",
    () => {

        if (
            !voiceReady &&
            document
                .getElementById("home")
                ?.classList
                .contains("active")
        ) {

            speak(
                "Welcome to AVITECH AI."
            );

        }

    },
    {
        once: true
    }
);

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
