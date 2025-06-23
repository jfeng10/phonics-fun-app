import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, addDoc, updateDoc, getDocs } from 'firebase/firestore';

// Ensure Tailwind CSS is available; usually configured in a build process
// For standalone HTML/React, a CDN might be used, but in Canvas, it's assumed.

const App = () => {
    // Firebase related states
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [loadingFirebase, setLoadingFirebase] = useState(true);
    // Use a state variable for the appId that comes from Firebase config
    const [appId, setAppId] = useState('default-app-id'); // Initialize with a default value

    // App specific states
    const [currentWordIndex, setCurrentWordIndex] = useState(0);
    const [words, setWords] = useState([
        { id: '1', text: 'cat', level: 'easy' },
        { id: '2', text: 'dog', level: 'easy' },
        { id: '3', text: 'run', level: 'easy' },
        { id: '4', text: 'jump', level: 'medium' },
        { id: '5', text: 'apple', level: 'medium' },
        { id: '6', text: 'banana', level: 'medium' },
        { id: '7', text: 'elephant', level: 'hard' },
        { id: '8', text: 'telephone', level: 'hard' },
        { id: '9', text: 'curious', level: 'hard' },
    ]); // Initial word list, will be dynamically updated by user progress
    const [flashcardFeedback, setFlashcardFeedback] = useState('');
    const [speechResult, setSpeechResult] = useState('');
    const [listening, setListening] = useState(false);
    const [pronunciationAnalysis, setPronunciationAnalysis] = useState('');
    const [showStoryFeature, setShowStoryFeature] = useState(false);
    const [storyLevel, setStoryLevel] = useState('beginner');
    const [generatedStory, setGeneratedStory] = useState('');
    const [storyLoading, setStoryLoading] = useState(false);
    const [comprehensionQuestions, setComprehensionQuestions] = useState([]);
    const [comprehensionAnswers, setComprehensionAnswers] = useState({});
    const [comprehensionFeedback, setComprehensionFeedback] = useState('');
    const [storyReadingFeedback, setStoryReadingFeedback] = useState('');

    // Speech Recognition API reference
    const recognitionRef = useRef(null);
    const synthRef = useRef(null); // Reference for SpeechSynthesis

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        try {
            // Parse firebaseConfig from environment variable
            // Ensure VITE_FIREBASE_CONFIG is correctly defined in your .env.local file
            const firebaseConfigRaw = import.meta.env.VITE_FIREBASE_CONFIG;
            let firebaseConfigParsed;
            try {
                // IMPORTANT: Ensure firebaseConfigRaw is a valid JSON string
                if (!firebaseConfigRaw) {
                    throw new Error("VITE_FIREBASE_CONFIG environment variable is not defined or is empty.");
                }
                firebaseConfigParsed = JSON.parse(firebaseConfigRaw);
            } catch (parseError) {
                console.error("Error parsing VITE_FIREBASE_CONFIG JSON:", parseError);
                console.error("Raw config received:", firebaseConfigRaw);
                setFlashcardFeedback("Firebase config is malformed. Please check your .env.local file.");
                setLoadingFirebase(false);
                setIsAuthReady(true);
                return; // Stop initialization if config is bad
            }

            // Set the app ID from the parsed config's projectId
            // projectId is typically used as the unique identifier for a Firebase app.
            const currentAppId = firebaseConfigParsed.projectId || 'default-phonics-app';
            setAppId(currentAppId);

            // Initialize Firebase only once
            const app = initializeApp(firebaseConfigParsed);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // Handle authentication state changes
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    // Sign in anonymously if no user is authenticated
                    try {
                        // For deployed apps, always sign in anonymously if no user is found.
                        // __initial_auth_token is only for the Canvas environment and not used here.
                        await signInAnonymously(firebaseAuth);
                        // After anonymous sign-in, get the new user's UID
                        setUserId(firebaseAuth.currentUser?.uid || crypto.randomUUID());
                    } catch (error) {
                        console.error("Firebase authentication error during anonymous sign-in:", error);
                        if (error.code === 'auth/operation-not-allowed') {
                            setFlashcardFeedback("Anonymous authentication is not enabled in your Firebase project. Please enable it in Firebase Console -> Authentication -> Sign-in method.");
                        } else if (error.code === 'auth/configuration-not-found') {
                            setFlashcardFeedback("Firebase authentication configuration not found. Check your .env.local and Firebase project settings carefully.");
                        } else {
                            setFlashcardFeedback(`Authentication error: ${error.message}.`);
                        }
                        // Fallback to random ID if anonymous sign-in also fails, but show error
                        setUserId(crypto.randomUUID());
                    }
                }
                setIsAuthReady(true);
                setLoadingFirebase(false);
            });

            // Cleanup subscription on unmount
            return () => unsubscribe();
        } catch (error) {
            console.error("General error during Firebase initialization (outside onAuthStateChanged):", error);
            setFlashcardFeedback(`Initialization error: ${error.message}. Please check console.`);
            setLoadingFirebase(false);
            setIsAuthReady(true); // Still set ready to allow app to proceed even if Firebase fails
        }
    }, []); // Empty dependency array means this runs once on mount

    // --- Fetch User Progress (words, struggling syllables) ---
    useEffect(() => {
        // Ensure db, userId, appId, and auth state are ready before attempting Firestore ops
        if (!db || !userId || !appId || !isAuthReady) {
            if (!isAuthReady && !loadingFirebase) {
                console.warn("Firestore listener skipped: Authentication not ready.");
            }
            return;
        }

        // Listener for user progress data - use the state `appId`
        const userProgressRef = collection(db, `artifacts/${appId}/users/${userId}/progress`);
        const unsubscribeProgress = onSnapshot(userProgressRef, (snapshot) => {
            const progressData = [];
            snapshot.forEach(doc => {
                progressData.push({ id: doc.id, ...doc.data() });
            });
            console.log("User Progress:", progressData);

            // Simple logic to reorder words based on past struggles
            // (e.g., move incorrect words to the end to revisit them)
            const newWords = [...words]; // Create a mutable copy
            progressData.forEach(p => {
                const wordObj = newWords.find(w => w.text === p.word);
                if (wordObj && p.correct === false) {
                    const index = newWords.indexOf(wordObj);
                    if (index > -1) {
                        newWords.splice(index, 1); // Remove from current position
                        newWords.push(wordObj);    // Add to the end
                    }
                }
            });
            setWords(newWords);

        }, (error) => {
            console.error("Error fetching user progress:", error);
            setFlashcardFeedback(`Error loading progress: ${error.message}`);
        });

        return () => {
            unsubscribeProgress(); // Clean up listener on unmount or dependency change
        };
    }, [db, userId, appId, isAuthReady]); // Depend on db, userId, appId, and isAuthReady

    // --- Speech Recognition Setup ---
    useEffect(() => {
        // Check for Web Speech API browser support
        if (!('webkitSpeechRecognition' in window)) {
            console.warn("Web Speech API not supported in this browser. Please use Chrome.");
            setFlashcardFeedback("Speech recognition not supported in your browser (Chrome recommended).");
            return;
        }

        const SpeechRecognition = window.webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false; // Listen for a single utterance
        recognitionRef.current.interimResults = false; // Only return final results
        recognitionRef.current.lang = 'en-US'; // Set language to English (US)

        recognitionRef.current.onstart = () => {
            setListening(true);
            setSpeechResult(''); // Clear previous results
            setFlashcardFeedback('Listening...');
        };

        recognitionRef.current.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            setSpeechResult(transcript);
            setListening(false);
            analyzePronunciation(transcript, words[currentWordIndex].text); // Analyze the spoken word
        };

        recognitionRef.current.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            setListening(false);
            // Provide user-friendly feedback based on common errors
            if (event.error === 'not-allowed') {
                setFlashcardFeedback("Microphone access denied. Please allow microphone permissions in your browser settings.");
            } else if (event.error === 'no-speech') {
                setFlashcardFeedback("No speech detected. Please try speaking louder or clearer.");
            } else {
                setFlashcardFeedback(`Speech recognition error: ${event.error}. Please try again.`);
            }
        };

        recognitionRef.current.onend = () => {
            setListening(false);
            // If no speech result was obtained, inform the user
            if (!speechResult && !flashcardFeedback.includes("Error:") && !flashcardFeedback.includes("not supported")) {
                 setFlashcardFeedback('No speech detected or recognized. Please try again.');
            }
        };

        // Initialize Web Speech Synthesis for text-to-speech
        if ('speechSynthesis' in window) {
            synthRef.current = window.speechSynthesis;
        } else {
            console.warn("Web Speech Synthesis API not supported in this browser.");
        }

    }, [words, currentWordIndex, speechResult, flashcardFeedback]); // Re-run if relevant states change to update recognition context/feedback

    // --- Text-to-Speech Function ---
    const speakWord = (text) => {
        if (synthRef.current) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US'; // Set language for pronunciation
            synthRef.current.speak(utterance);
        } else {
            console.warn("Speech Synthesis not available to speak the word.");
            setFlashcardFeedback("Speech Synthesis not available to hear the word.");
        }
    };

    // --- LLM Interaction for Pronunciation Analysis (Flashcards) ---
    const analyzePronunciation = async (spokenText, expectedWord) => {
        setFlashcardFeedback('Analyzing pronunciation...');
        setPronunciationAnalysis('');
        // Ensure all necessary dependencies are available
        if (!db || !userId || !appId) {
            setFlashcardFeedback('Error: Authentication or app ID missing for analysis. Please refresh.');
            return;
        }

        // Simple check for immediate feedback, before LLM call
        const isCorrectSimple = spokenText.toLowerCase().trim() === expectedWord.toLowerCase().trim();

        // Prompt for the LLM to get detailed pronunciation feedback
        const prompt = `Compare the spoken word "${spokenText}" with the expected word "${expectedWord}". If they are different, explain what might be wrong with the pronunciation (e.g., missing sounds, incorrect vowel, syllable stress) and identify any specific syllables that might be difficult. If they are the same, just say "Great pronunciation!"
        
        Provide the response in the following JSON format:
        {
          "isCorrect": boolean, // True if pronunciation is considered correct
          "feedback": "string explaining correction or praise",
          "strugglingSyllables": ["syllable1", "syllable2"] // Optional array, only if struggling syllables are identified
        }`;

        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY; // Access API key from environment variable
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        try {
            const payload = {
                contents: chatHistory,
                generationConfig: {
                    responseMimeType: "application/json", // Request JSON for structured feedback
                    responseSchema: { // Define expected JSON structure for reliable parsing
                        type: "OBJECT",
                        properties: {
                            "isCorrect": { "type": "BOOLEAN" },
                            "feedback": { "type": "STRING" },
                            "strugglingSyllables": {
                                "type": "ARRAY",
                                "items": { "type": "STRING" }
                            }
                        }
                    }
                }
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            // Check if the LLM returned valid content
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const responseText = result.candidates[0].content.parts[0].text;
                let parsedFeedback;
                try {
                    parsedFeedback = JSON.parse(responseText); // Attempt to parse the JSON response
                } catch (jsonError) {
                    console.warn("LLM response was not valid JSON, falling back to raw text:", responseText, jsonError);
                    // Fallback if LLM doesn't return perfect JSON
                    parsedFeedback = {
                        isCorrect: isCorrectSimple, // Rely on simple check
                        feedback: "Received an unexpected response format. " + responseText,
                        strugglingSyllables: []
                    };
                }

                setPronunciationAnalysis(parsedFeedback.feedback);
                setFlashcardFeedback(parsedFeedback.feedback); // Display feedback to user

                // Save user progress to Firestore using the correct appId and userId
                const progressCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/progress`);
                await addDoc(progressCollectionRef, {
                    word: expectedWord,
                    spoken: spokenText,
                    correct: parsedFeedback.isCorrect,
                    strugglingSyllables: parsedFeedback.strugglingSyllables || [], // Ensure it's an array
                    timestamp: new Date(),
                });

            } else {
                setFlashcardFeedback('Could not get detailed analysis from AI. Please try again.');
            }
        } catch (error) {
            console.error("LLM API call or Firestore write error:", error);
            setFlashcardFeedback(`Error analyzing: ${error.message}. Please check your Gemini API key and network connection.`);
            // Ensure Firestore save happens even if LLM call fails
            const progressCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/progress`);
            await addDoc(progressCollectionRef, {
                word: expectedWord,
                spoken: spokenText,
                correct: isCorrectSimple, // Fallback to simple check
                strugglingSyllables: [],
                timestamp: new Date(),
            });
        }
    };

    const startListening = () => {
        if (recognitionRef.current) {
            setSpeechResult(''); // Clear previous result
            setPronunciationAnalysis(''); // Clear previous analysis
            setFlashcardFeedback(''); // Clear general feedback
            try {
                recognitionRef.current.start();
            } catch (error) {
                console.error("Error starting speech recognition:", error);
                // More specific error message for common start issues
                setFlashcardFeedback("Microphone access denied or already listening. Please ensure microphone permissions are granted and refresh.");
            }
        } else {
            setFlashcardFeedback("Speech recognition not available. Please use a compatible browser like Chrome.");
        }
    };

    const goToNextWord = () => {
        setSpeechResult('');
        setFlashcardFeedback('');
        setPronunciationAnalysis('');
        setCurrentWordIndex((prevIndex) => (prevIndex + 1) % words.length);
    };

    // --- LLM Interaction for Story Generation ---
    const generateStory = async () => {
        setGeneratedStory('');
        setComprehensionQuestions([]);
        setComprehensionAnswers({});
        setComprehensionFeedback('');
        setStoryReadingFeedback('');
        setStoryLoading(true);

        const prompt = `Generate a short story for an early reader at a "${storyLevel}" reading level. The story should be engaging and around 100-150 words. Focus on simple vocabulary and sentence structures appropriate for their level. Please also provide 3-4 simple comprehension questions based on the story in a JSON array format.

        Example JSON format:
        {
            "story": "...",
            "questions": [
                {"id": 1, "question": "What is the main character's name?"},
                {"id": 2, "question": "Where does the story take place?"}
            ]
        }`;

        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY; // Access API key from environment variable
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        try {
            const payload = {
                contents: chatHistory,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: { // Define expected JSON structure
                        type: "OBJECT",
                        properties: {
                            "story": { "type": "STRING" },
                            "questions": {
                                "type": "ARRAY",
                                "items": {
                                    type: "OBJECT",
                                    properties: {
                                        "id": { "type": "NUMBER" },
                                        "question": { "type": "STRING" }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const responseText = result.candidates[0].content.parts[0].text;
                const parsedContent = JSON.parse(responseText); // Parse the JSON story and questions
                setGeneratedStory(parsedContent.story);
                setComprehensionQuestions(parsedContent.questions);

                // Save generated story to Firestore using the correct appId and userId
                const storiesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/stories`);
                await addDoc(storiesCollectionRef, {
                    level: storyLevel,
                    story: parsedContent.story,
                    questions: parsedContent.questions,
                    timestamp: new Date(),
                });

            } else {
                setGeneratedStory('Could not generate story. Please try again.');
            }
        } catch (error) {
            console.error("Error generating story:", error);
            setGeneratedStory(`Error generating story: ${error.message}. Please check your Gemini API key and network connection.`);
        } finally {
            setStoryLoading(false);
        }
    };

    // --- LLM Interaction for Comprehension Analysis ---
    const evaluateComprehension = async () => {
        setComprehensionFeedback('Evaluating answers...');
        // Ensure all necessary dependencies are available
        if (!db || !userId || !appId || !generatedStory || comprehensionQuestions.length === 0) {
            setComprehensionFeedback('Please generate a story and answer questions first, or app ID/authentication is missing.');
            return;
        }

        const answersList = comprehensionQuestions.map(q => ({
            question: q.question,
            answer: comprehensionAnswers[q.id] || '' // Get user's answer
        }));

        const prompt = `The user read the following story:\n\n"${generatedStory}"\n\nThey answered the following comprehension questions:\n${JSON.stringify(answersList, null, 2)}\n\nPlease evaluate their answers. For each question, indicate if the answer is correct/reasonable, partially correct, or incorrect. Provide a summary of their understanding and suggest areas for improvement if needed. Return the feedback in JSON format.

        Example JSON format:
        {
          "summary": "...",
          "questionFeedbacks": [
            {"id": 1, "feedback": "Correct."},
            {"id": 2, "feedback": "Partially correct. You mentioned X, but it was Y."}
          ]
        }`;

        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY; // Access API key from environment variable
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        try {
            const payload = {
                contents: chatHistory,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: { // Define expected JSON structure
                        type: "OBJECT",
                        properties: {
                            "summary": { "type": "STRING" },
                            "questionFeedbacks": {
                                "type": "ARRAY",
                                "items": {
                                    type: "OBJECT",
                                    properties: {
                                        "id": { "type": "NUMBER" },
                                        "feedback": { "type": "STRING" }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.content.parts.length > 0) {
                const responseText = result.candidates[0].content.parts[0].text;
                const parsedFeedback = JSON.parse(responseText); // Parse the JSON feedback

                // Combine summary and individual question feedback for display
                let fullFeedback = parsedFeedback.summary + "\n\n";
                parsedFeedback.questionFeedbacks.forEach(qf => {
                    fullFeedback += `Q${qf.id}: ${qf.feedback}\n`;
                });
                setComprehensionFeedback(fullFeedback);

                // Update the last saved story in Firestore with comprehension results
                // This assumes we are evaluating the most recently generated story for the user.
                const storiesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/stories`);
                const q = query(storiesCollectionRef);
                const snapshot = await getDocs(q); // Fetch all stories to find the latest
                let latestStoryDoc = null;
                snapshot.forEach(doc => {
                    if (!latestStoryDoc || (doc.data().timestamp && doc.data().timestamp.toDate() > latestStoryDoc.data().timestamp.toDate())) {
                        latestStoryDoc = doc;
                    }
                });

                if (latestStoryDoc) {
                    await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/stories`, latestStoryDoc.id), {
                        comprehensionAnswers: comprehensionAnswers,
                        comprehensionFeedback: fullFeedback,
                        evaluatedAt: new Date()
                    });
                } else {
                    console.warn("No story found to update comprehension results.");
                }

            } else {
                setComprehensionFeedback('Could not evaluate answers from AI. Please try again.');
            }
        } catch (error) {
            console.error("Error evaluating comprehension:", error);
            setComprehensionFeedback(`Error evaluating: ${error.message}. Please check your Gemini API key and network connection.`);
        }
    };

    const handleAnswerChange = (questionId, value) => {
        setComprehensionAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    // --- Render Loading/Error States ---
    if (loadingFirebase) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
                <div className="text-xl text-gray-700">Loading application...</div>
            </div>
        );
    }

    if (!isAuthReady) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
                <div className="text-xl text-red-500">Authentication failed or not ready. Please refresh.</div>
            </div>
        );
    }

    // --- Main App UI ---
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 p-4 font-inter text-gray-800 flex flex-col items-center">
            <h1 className="text-4xl font-extrabold text-blue-800 mb-6 text-center rounded-xl p-3 bg-white shadow-lg">
                Phonics Fun Time!
            </h1>

            <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl p-8 mb-8">
                <div className="flex justify-center mb-6">
                    <button
                        onClick={() => setShowStoryFeature(false)}
                        className={`px-8 py-3 rounded-full text-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
                            !showStoryFeature ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-blue-500 hover:text-white'
                        }`}
                    >
                        Flashcards
                    </button>
                    <button
                        onClick={() => setShowStoryFeature(true)}
                        className={`ml-4 px-8 py-3 rounded-full text-lg font-semibold transition-all duration-300 transform hover:scale-105 ${
                            showStoryFeature ? 'bg-purple-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-purple-500 hover:text-white'
                        }`}
                    >
                        Story Time
                    </button>
                </div>

                {showStoryFeature ? (
                    // --- Story Reading Feature ---
                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-purple-700 mb-6">Story Time Adventures!</h2>
                        <div className="mb-6 flex flex-wrap items-center justify-center gap-4">
                            <label htmlFor="storyLevel" className="font-semibold text-lg">Reading Level:</label>
                            <select
                                id="storyLevel"
                                value={storyLevel}
                                onChange={(e) => setStoryLevel(e.target.value)}
                                className="p-3 border-2 border-purple-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                            >
                                <option value="beginner">Beginner (Kindergarten)</option>
                                <option value="intermediate">Intermediate (1st-2nd Grade)</option>
                                <option value="advanced">Advanced (3rd Grade +)</option>
                            </select>
                            <button
                                onClick={generateStory}
                                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-6 py-3 rounded-full text-lg font-bold shadow-lg hover:from-purple-600 hover:to-pink-600 transition-all duration-300 transform hover:scale-105"
                                disabled={storyLoading}
                            >
                                {storyLoading ? 'Generating...' : 'Generate Story'}
                            </button>
                        </div>

                        {generatedStory && (
                            <div className="mt-8 bg-gray-50 p-6 rounded-xl shadow-inner text-left">
                                <h3 className="text-2xl font-bold text-purple-600 mb-4">Your Story:</h3>
                                <p className="text-lg leading-relaxed mb-4">{generatedStory}</p>
                                <div className="mt-4 flex justify-center">
                                    <button
                                        onClick={() => speakWord(generatedStory)}
                                        className="bg-purple-500 text-white px-5 py-2 rounded-full text-md font-semibold shadow-md hover:bg-purple-600 transition-all duration-200"
                                    >
                                        <i className="fas fa-volume-up mr-2"></i> Listen to Story
                                    </button>
                                </div>
                                <p className="text-gray-600 text-sm mt-2">
                                    (For story reading feedback, you'd integrate speech recognition here and compare it to the full story text, similar to flashcards but more complex for continuous speech.)
                                </p>
                                {storyReadingFeedback && (
                                    <p className="mt-4 text-orange-600 text-lg font-semibold">{storyReadingFeedback}</p>
                                )}

                                {comprehensionQuestions.length > 0 && (
                                    <div className="mt-8 pt-6 border-t-2 border-purple-200">
                                        <h3 className="text-2xl font-bold text-purple-600 mb-4">Comprehension Questions:</h3>
                                        {comprehensionQuestions.map(q => (
                                            <div key={q.id} className="mb-4 text-left">
                                                <p className="text-lg font-semibold mb-2">{q.question}</p>
                                                <textarea
                                                    className="w-full p-3 border-2 border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                                                    rows="3"
                                                    value={comprehensionAnswers[q.id] || ''}
                                                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                                    placeholder="Type your answer here..."
                                                ></textarea>
                                            </div>
                                        ))}
                                        <button
                                            onClick={evaluateComprehension}
                                            className="bg-gradient-to-r from-teal-500 to-cyan-500 text-white px-6 py-3 rounded-full text-lg font-bold shadow-lg hover:from-teal-600 hover:to-cyan-600 transition-all duration-300 transform hover:scale-105 mt-4"
                                            disabled={Object.keys(comprehensionAnswers).length === 0}
                                        >
                                            Check Understanding
                                        </button>
                                        {comprehensionFeedback && (
                                            <div className="mt-6 p-4 bg-teal-50 rounded-lg shadow-inner text-left text-lg">
                                                <h4 className="font-bold text-teal-700">Feedback:</h4>
                                                <p className="whitespace-pre-wrap">{comprehensionFeedback}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    // --- Flashcard Feature ---
                    <div className="text-center">
                        <h2 className="text-3xl font-bold text-blue-700 mb-6">Phonics Flashcards</h2>
                        <div className="min-h-[150px] bg-blue-50 border-4 border-blue-300 rounded-3xl flex items-center justify-center p-6 shadow-inner mb-6 transition-all duration-300 transform hover:scale-100">
                            <p className="text-7xl md:text-8xl font-black text-blue-900 drop-shadow-lg select-none">
                                {words[currentWordIndex]?.text || 'Loading...'}
                            </p>
                        </div>
                        <div className="flex flex-col md:flex-row justify-center items-center gap-4 mb-6">
                            <button
                                onClick={() => speakWord(words[currentWordIndex]?.text)}
                                className="bg-blue-500 text-white px-6 py-3 rounded-full text-lg font-bold shadow-lg hover:bg-blue-600 transition-all duration-300 transform hover:scale-105 flex items-center justify-center"
                            >
                                <i className="fas fa-volume-up mr-2"></i> Hear Word
                            </button>
                            <button
                                onClick={startListening}
                                className={`bg-green-500 text-white px-6 py-3 rounded-full text-lg font-bold shadow-lg hover:bg-green-600 transition-all duration-300 transform hover:scale-105 flex items-center justify-center ${listening ? 'opacity-70 cursor-not-allowed' : ''}`}
                                disabled={listening}
                            >
                                {listening ? (
                                    <>
                                        <i className="fas fa-microphone-alt mr-2 animate-pulse"></i> Listening...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-microphone mr-2"></i> Read Word
                                    </>
                                )}
                            </button>
                            <button
                                onClick={goToNextWord}
                                className="bg-gray-300 text-gray-800 px-6 py-3 rounded-full text-lg font-bold shadow-lg hover:bg-gray-400 transition-all duration-300 transform hover:scale-105 flex items-center justify-center"
                            >
                                Next Word <i className="fas fa-arrow-right ml-2"></i>
                            </button>
                        </div>

                        {flashcardFeedback && (
                            <p className="mt-4 p-3 bg-blue-50 rounded-lg text-blue-700 text-lg font-semibold shadow-inner">{flashcardFeedback}</p>
                        )}
                        {speechResult && (
                            <p className="mt-2 text-gray-600 text-md">You said: "<span className="font-bold text-gray-800">{speechResult}</span>"</p>
                        )}
                        {pronunciationAnalysis && (
                            <div className="mt-4 p-4 bg-blue-100 rounded-lg shadow-md text-left text-lg">
                                <h4 className="font-bold text-blue-800">Analysis:</h4>
                                <p className="whitespace-pre-wrap">{pronunciationAnalysis}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="mt-8 text-sm text-gray-600 text-center">
                <p>Your User ID: <span className="font-semibold text-gray-800">{userId}</span></p>
                <p className="mt-2">
                    <a href="https://support.google.com/chrome/answer/2693767?hl=en" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                        Enable microphone in Chrome
                    </a>
                    {' '}if speech recognition is not working.
                </p>
            </div>
            {/* Font Awesome for icons (example: microphone, volume) */}
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css" xintegrity="sha512-1ycn6IcaQQ40/MKBW2W4Rhis/DbILU74C1vSrLJxCq57o941Ym01SwNsOMqvzBNcQy6bOblK/HJAO1ExfQ5MQQ==" crossOrigin="anonymous" referrerPolicy="no-referrer" />
        </div>
    );
};

export default App;
