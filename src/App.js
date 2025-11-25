import React, { useState, useEffect, useRef } from 'react';
import { Search, Volume2, Star, BookOpen, ArrowRight, Loader2, Layers, X, ChevronDown, ChevronUp, Info, Mic, MessageCircle, Send, Heart, PlayCircle, Globe, LayoutGrid, Sparkles, Feather } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, deleteDoc, doc, serverTimestamp, where, getDocs } from 'firebase/firestore';

// ==========================================
// ⚠️ 请在下方填入您的配置信息
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyCBItd52zWdktiEuHmQIXbB4Q7sLM5602o",
  authDomain: "frenchapp-6b44a.firebaseapp.com",
  projectId: "frenchapp-6b44a",
  storageBucket: "frenchapp-6b44a.firebasestorage.app",
  messagingSenderId: "988616724582",
  appId: "1:988616724582:web:723f9d9c75f8810b019da7"
};


const GEMINI_API_KEY = "AIzaSyBivevjn0wQ3dD2OCuh98L2iALBssZfsq4"; 

// ==========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "french-memo-app";

// --- API Helper for Gemini ---

// 1. 获取单个单词详情
const fetchWordData = async (input) => {
  const apiKey = GEMINI_API_KEY; 
  if (!apiKey || apiKey.includes("YOUR_GEMINI_API_KEY")) throw new Error("API Key not set");

  const prompt = `
    User input: "${input}".
    Task: 
    1. Detect language. If NOT French, translate to common French word.
    2. Analyze the French word.
    
    CRITICAL: Keep definitions EXTREMELY SHORT (1-3 words max). Just the direct translation. NO explanations.
    
    Return strictly valid JSON (no markdown):
    {
      "word": "The French word",
      "definitions": {
        "en": "Direct translation (1-3 words)",
        "zh": "直接的中文对应词(仅词义，不解释)"
      },
      "partOfSpeech": "abbrev. (n.m./adj.)",
      "collection": "Category (e.g. Fruits)",
      "relatedWords": ["synonym1", "antonym1", "related1"],
      "relatedPhrases": [
        {"fr": "Phrase 1", "zh": "Meaning 1"},
        {"fr": "Phrase 2", "zh": "Meaning 2"}
      ],
      "examplePhrase": {
        "fr": "Simple French sentence",
        "en": "English translation",
        "zh": "Chinese translation",
        "explanation": "Brief grammar note"
      }
    }
  `;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? JSON.parse(text) : null;
};

// 2. 获取专辑列表
const fetchAlbumData = async (category) => {
  const apiKey = GEMINI_API_KEY;
  const prompt = `
    List 8 common French vocabulary items for category: "${category}".
    Return valid JSON:
    {
      "category": "${category}",
      "items": [
        { "word": "FrenchWord", "article": "le/la/un", "zh": "Chinese", "isVisual": true/false }
      ]
    }
  `;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? JSON.parse(text) : null;
};

// 3. 聊天 API
const fetchChatResponse = async (history, message) => {
  const apiKey = GEMINI_API_KEY;
  const prompt = `
    You are a friendly French language tutor. 
    User message: "${message}".
    Conversation history: ${JSON.stringify(history)}.
    
    Task: Reply in French. 
    CRITICAL FORMATTING: After your French reply, add the separator "|||" and then provide the English translation.
    Example output: Bonjour, comment ça va? ||| Hello, how are you?
  `;
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Désolé, je ne comprends pas. ||| Sorry, I don't understand.";
};

// --- Sub-Components ---

// 修复：移除随机种子并增加 URL 编码，确保图片加载稳定且支持特殊字符
const getImageUrl = (keyword, size = 'medium') => {
  const dimensions = size === 'small' ? 'width=200&height=200' : 'width=600&height=400';
  const encodedKeyword = encodeURIComponent(keyword);
  return `https://image.pollinations.ai/prompt/realistic%20${encodedKeyword}%20french%20context?${dimensions}&nologo=true`;
};

// 修复发音不连贯：使用全局变量防止 Utterance 被垃圾回收
let currentUtterance = null;
const handleSpeak = (text) => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';
    utterance.rate = 0.9;
    
    // 保存引用
    currentUtterance = utterance;
    
    utterance.onend = () => {
      currentUtterance = null;
    };
    
    window.speechSynthesis.speak(utterance);
  }
};

const AlbumView = ({ data, handleSearch, favoriteAlbums, toggleFavoriteAlbum, setActiveTab }) => {
  if (!data) return null;
  const isFav = favoriteAlbums.some(f => f.category === data.category);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveTab('search')} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowRight className="rotate-180 text-gray-500" />
          </button>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layers className="text-blue-600" size={24} />
            {data.category}
          </h2>
        </div>
        <button 
          onClick={() => toggleFavoriteAlbum(data)}
          className={`p-3 rounded-full transition-colors ${isFav ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400 hover:text-red-400'}`}
        >
          <Heart size={24} fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {data.items.map((item, idx) => {
          if (item.isVisual) {
            return (
              <button 
                key={idx}
                onClick={() => handleSearch(null, item.word)}
                className="group relative flex flex-col items-center bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-gray-100 text-left"
              >
                <div className="w-full aspect-[4/3] bg-gray-50 relative overflow-hidden">
                  <img 
                    src={getImageUrl(item.word, 'small')} 
                    alt={item.word} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
                     <p className="text-white font-medium text-lg">
                       <span className="opacity-70 text-sm mr-1 font-normal">{item.article}</span>
                       {item.word}
                     </p>
                  </div>
                </div>
              </button>
            );
          } else {
            return (
              <button 
                key={idx}
                onClick={() => handleSearch(null, item.word)}
                className="col-span-2 flex items-center justify-between p-4 bg-white rounded-xl shadow-sm hover:shadow-md border border-gray-100 hover:border-blue-200 transition-all group"
              >
                <div>
                  <span className="text-lg font-bold text-gray-800 group-hover:text-blue-600 transition-colors">{item.word}</span>
                </div>
                <span className="text-sm text-gray-500 font-medium">{item.zh}</span>
              </button>
            );
          }
        })}
      </div>
    </div>
  );
};

const WordCard = ({ data, onDelete, handleAlbumClick, handleSearch, toggleFavoriteWord, favorites }) => {
  const [showPhraseDetails, setShowPhraseDetails] = useState(false);
  const [showAllPhrases, setShowAllPhrases] = useState(false);
  const isFav = favorites.some(f => f.word === data.word);

  return (
  <div className="bg-white rounded-[2rem] shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 mb-8">
    <div className="h-56 overflow-hidden bg-gray-50 relative">
      <img src={getImageUrl(data.word)} alt={data.word} className="w-full h-full object-cover" />
    </div>

    <div className="flex gap-2 px-8 pt-4 bg-white">
      <span className="bg-blue-50 px-3 py-1.5 rounded-full text-xs font-bold text-blue-600 uppercase tracking-wider">
        {data.partOfSpeech}
      </span>
      <button 
        onClick={() => handleAlbumClick(data.collection)}
        className="bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full text-xs font-bold text-gray-600 flex items-center gap-1.5 transition-colors cursor-pointer"
      >
        <Layers size={14} />
        {data.collection}
      </button>
    </div>

    <div className="p-8 pt-2">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-4xl font-bold text-gray-900 tracking-tight">{data.word}</h2>
          <button onClick={(e) => { e.stopPropagation(); handleSpeak(data.word); }} className="p-2.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
            <Volume2 size={20} />
          </button>
        </div>
        {onDelete ? (
           <button onClick={() => onDelete(data.id)} className="p-2.5 rounded-full text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
             <X size={22} />
           </button>
        ) : (
           <button onClick={() => toggleFavoriteWord(data)} className={`p-2.5 rounded-full transition-colors ${isFav ? 'text-yellow-400 bg-yellow-50' : 'text-gray-300 hover:text-yellow-400 hover:bg-yellow-50'}`}>
             <Star size={22} fill={isFav ? "currentColor" : "none"} />
           </button>
        )}
      </div>

      {/* 释义：单行布局，左对齐 */}
      <div className="mb-6 text-left">
         <p className="text-lg text-gray-800 leading-normal flex flex-wrap items-baseline gap-2">
           <span className="font-bold">{data.definitions.zh}</span>
           <span className="text-gray-300 font-light">|</span>
           <span className="text-gray-600 font-medium font-serif italic">{data.definitions.en}</span>
         </p>
      </div>

      {/* 交互式例句 */}
      <div className="space-y-3">
        <div onClick={() => { handleSpeak(data.examplePhrase.fr); setShowPhraseDetails(!showPhraseDetails); }} className="bg-blue-50/50 rounded-xl border border-blue-100 overflow-hidden cursor-pointer hover:bg-blue-50 transition-colors">
          <div className="p-4 flex justify-between items-start gap-3">
             <div>
               <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Exemple</span>
                  <Mic size={12} className="text-blue-400" />
               </div>
               <p className="text-xl text-gray-800 font-serif italic leading-snug">"{data.examplePhrase.fr}"</p>
             </div>
             <ChevronDown size={18} className={`text-blue-300 mt-2 transition-transform ${showPhraseDetails ? 'rotate-180' : ''}`} />
          </div>
          {/* 减小了间距 pt-0 */}
          {showPhraseDetails && (
            <div className="px-4 pb-4 pt-0 space-y-1.5 animate-in slide-in-from-top-2">
               <p className="text-sm text-gray-600">{data.examplePhrase.zh}</p>
               <p className="text-sm text-gray-500">{data.examplePhrase.en}</p>
               {data.examplePhrase.explanation && (
                 <div className="mt-2 text-xs text-blue-500 bg-blue-100/50 p-2 rounded-lg">💡 {data.examplePhrase.explanation}</div>
               )}
            </div>
          )}
        </div>

        {/* 相关短语 */}
        {data.relatedPhrases && data.relatedPhrases.length > 0 && (
          <div className="pl-2 pt-2">
            <h4 className="text-xs font-bold text-gray-400 uppercase mb-2 tracking-wider">常用短语</h4>
            <div className="space-y-1.5">
              {data.relatedPhrases.slice(0, showAllPhrases ? undefined : 2).map((phrase, idx) => (
                 <div key={idx} className="flex justify-between items-center group py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-700 font-medium cursor-pointer hover:text-blue-600" onClick={() => handleSpeak(phrase.fr)}>{phrase.fr}</span>
                    <span className="text-sm text-gray-400">{phrase.zh}</span>
                 </div>
              ))}
            </div>
            {data.relatedPhrases.length > 2 && (
              <button onClick={() => setShowAllPhrases(!showAllPhrases)} className="text-xs text-blue-500 font-medium mt-2 hover:underline flex items-center gap-1">
                {showAllPhrases ? "收起" : `查看更多 (${data.relatedPhrases.length - 2})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 底部相关词 */}
      {data.relatedWords && data.relatedWords.length > 0 && (
        <div className="pt-6 mt-6 border-t border-gray-100">
           <div className="flex overflow-x-auto pb-4 gap-3 no-scrollbar">
              {data.relatedWords.map((word, idx) => (
                <button key={idx} onClick={() => handleSearch(null, word)} className="flex-shrink-0 flex flex-col items-center w-20 group">
                  <div className="w-16 h-16 rounded-xl overflow-hidden mb-2 bg-gray-100 border border-gray-200 group-hover:border-blue-300 transition-all">
                     <img src={getImageUrl(word, 'small')} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all" />
                  </div>
                  <span className="text-xs text-gray-500 group-hover:text-blue-600 truncate w-full text-center">{word}</span>
                </button>
              ))}
           </div>
        </div>
      )}
    </div>
  </div>
  );
};

const ChatView = ({ messages, chatInput, setChatInput, handleSendChat, startListening, isRecording, chatEndRef, toggleTranslation }) => (
  <div className="flex flex-col h-full">
    {/* 消息列表 - 增加 pb-32 为底部输入框留出足够空间 */}
    <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-32">
      {messages.map((msg, idx) => (
        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] p-4 rounded-2xl ${
            msg.role === 'user' 
              ? 'bg-blue-600 text-white rounded-br-none' 
              : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none shadow-sm'
          }`}>
            <p className="text-base leading-relaxed">{msg.text}</p>
            
            {/* 翻译区域 */}
            {msg.role === 'ai' && !msg.isLoading && msg.translation && (
              <div className="mt-2 pt-2 border-t border-gray-100">
                {msg.showTranslation ? (
                   <p className="text-sm text-gray-500 animate-in fade-in">{msg.translation}</p>
                ) : (
                   <button 
                     onClick={() => toggleTranslation(idx)} 
                     className="text-xs text-blue-400 font-medium flex items-center gap-1 hover:text-blue-600"
                   >
                     <Globe size={12} /> 显示翻译
                   </button>
                )}
              </div>
            )}

            {/* 发音按钮 */}
            {msg.role === 'ai' && !msg.isLoading && (
               <div className="mt-2 flex justify-end">
                 <button onClick={() => handleSpeak(msg.text)} className="text-blue-300 hover:text-blue-600 p-1"><Volume2 size={16} /></button>
               </div>
            )}
          </div>
        </div>
      ))}
      <div ref={chatEndRef} />
    </div>
    
    {/* 输入框区域 - 使用 sticky bottom-0 配合 margin 确保位置合适且贴合底部导航上方 */}
    <div className="p-4 bg-white border-t border-gray-100 sticky bottom-0 z-20">
      <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-full border border-gray-200 focus-within:ring-2 focus-within:ring-blue-100 transition-all shadow-sm">
        <input 
          type="text" 
          value={chatInput} 
          onChange={e => setChatInput(e.target.value)} 
          placeholder="说点法语..." 
          className="flex-1 bg-transparent border-none focus:ring-0 px-4 py-2 text-gray-800 placeholder-gray-400"
          onKeyDown={e => e.key === 'Enter' && handleSendChat()}
        />
        <button 
          onClick={startListening} 
          className={`p-2 rounded-full transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-blue-600'}`}
        >
          <Mic size={20} />
        </button>
        <button 
          onClick={handleSendChat} 
          className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
          disabled={!chatInput.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  </div>
);

// 优化后的极简风格浮动单词 (Magazine Style)
const FloatingWords = ({ onWordClick }) => {
  // 每天随机展示6个单词 (带颜色主题)
  const wordsPool = [
    { word: 'Amour', bg: 'bg-rose-50', text: 'text-rose-900', sub: 'Love' },
    { word: 'Rêve', bg: 'bg-indigo-50', text: 'text-indigo-900', sub: 'Dream' },
    { word: 'Étoile', bg: 'bg-amber-50', text: 'text-amber-900', sub: 'Star' },
    { word: 'Lumière', bg: 'bg-sky-50', text: 'text-sky-900', sub: 'Light' },
    { word: 'Voyage', bg: 'bg-emerald-50', text: 'text-emerald-900', sub: 'Travel' },
    { word: 'Océan', bg: 'bg-cyan-50', text: 'text-cyan-900', sub: 'Ocean' },
    { word: 'Espoir', bg: 'bg-fuchsia-50', text: 'text-fuchsia-900', sub: 'Hope' },
    { word: 'Soleil', bg: 'bg-orange-50', text: 'text-orange-900', sub: 'Sun' },
    { word: 'Lune', bg: 'bg-slate-50', text: 'text-slate-900', sub: 'Moon' },
    { word: 'Fleur', bg: 'bg-pink-50', text: 'text-pink-900', sub: 'Flower' }
  ];
  
  const [displayWords, setDisplayWords] = useState([]);

  useEffect(() => {
    // 简单的随机混洗取前6个
    const shuffled = [...wordsPool].sort(() => 0.5 - Math.random());
    setDisplayWords(shuffled.slice(0, 6));
  }, []);

  return (
    <div className="mb-12">
      <div className="text-center mb-8 mt-4">
        <h3 className="text-2xl font-serif font-bold text-gray-800 mb-2">Découverte Quotidienne</h3>
        <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
          <Sparkles size={14} className="text-yellow-500" />
          <span>每日法语灵感</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        {displayWords.map((item, i) => (
          <button
            key={i}
            onClick={() => onWordClick(item.word)}
            className={`group relative h-32 rounded-3xl ${item.bg} hover:shadow-lg transition-all duration-500 flex flex-col items-center justify-center overflow-hidden border border-white/50`}
          >
             {/* 装饰图标 */}
             <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-20 transition-opacity duration-500">
                <Feather size={24} className={item.text} />
             </div>

             <span className={`text-2xl font-serif font-bold ${item.text} group-hover:scale-110 transition-transform duration-500`}>
               {item.word}
             </span>
             <span className={`text-xs uppercase tracking-widest mt-2 ${item.text} opacity-60 font-medium`}>
               {item.sub}
             </span>
             
             {/* 底部微光效果 */}
             <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentWordData, setCurrentWordData] = useState(null);
  const [greeting, setGreeting] = useState('');
  
  // 缓存机制
  const [wordCache, setWordCache] = useState({}); 
  const [albumData, setAlbumData] = useState(null);
  const [albumCache, setAlbumCache] = useState({}); 

  // 收藏相关
  const [favorites, setFavorites] = useState([]);
  const [favoriteAlbums, setFavoriteAlbums] = useState([]);

  // 聊天相关
  const [messages, setMessages] = useState([{ 
    role: 'ai', 
    text: 'Bonjour! Je suis ton prof de français.', 
    translation: 'Hello! I am your French teacher.',
    showTranslation: false
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const chatEndRef = useRef(null);

  const [activeTab, setActiveTab] = useState('search'); 

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 设置问候语
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Bonjour');
    else if (hour < 18) setGreeting('Bon après-midi');
    else setGreeting('Bonsoir');
  }, []);

  // Sync Logic (Favorites)
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'favorites'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      favs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
      setFavorites(favs);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'favoriteAlbums'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const favs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFavoriteAlbums(favs);
    });
    return () => unsubscribe();
  }, [user]);

  // Scroll Chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  // --- Handlers ---
  const handleSearch = async (e, wordOverride = null) => {
    if (e) e.preventDefault();
    const term = wordOverride || searchTerm;
    const cleanTerm = term.trim().toLowerCase();
    if (!cleanTerm) return;
    
    setLoading(true);
    setCurrentWordData(null);
    setAlbumData(null);
    setActiveTab('search');
    setSearchTerm(term); // Sync input box

    if (wordCache[cleanTerm]) {
      setCurrentWordData(wordCache[cleanTerm]);
      setLoading(false);
      return;
    }
    
    try {
      const data = await fetchWordData(term);
      setCurrentWordData(data);
      setWordCache(prev => ({ ...prev, [cleanTerm]: data, [data.word.toLowerCase()]: data })); 
    } catch (err) { alert("Error fetching word. Try again."); } 
    finally { setLoading(false); }
  };

  const handleAlbumClick = async (category) => {
    setActiveTab('album');
    if (albumCache[category]) {
      setAlbumData(albumCache[category]);
      return;
    }
    setLoading(true);
    setAlbumData(null);
    try {
      const data = await fetchAlbumData(category);
      setAlbumData(data);
      setAlbumCache(prev => ({ ...prev, [category]: data }));
    } catch (err) { console.error(err); alert("Failed to load album."); setActiveTab('search'); }
    finally { setLoading(false); }
  };

  const toggleFavoriteWord = async (wordData) => {
    if (!user) return;
    const existing = favorites.find(f => f.word === wordData.word);
    try {
      if (existing) {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'favorites', existing.id));
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'favorites'), { ...wordData, timestamp: serverTimestamp() });
      }
    } catch (e) { console.error("Fav Error", e); }
  };

  const toggleFavoriteAlbum = async (albumData) => {
    if (!user || !albumData) return;
    const existing = favoriteAlbums.find(f => f.category === albumData.category);
    try {
      if (existing) {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'favoriteAlbums', existing.id));
      } else {
        await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'favoriteAlbums'), { ...albumData, timestamp: serverTimestamp() });
      }
    } catch (e) { console.error("Album Fav Error", e); }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { role: 'user', text: chatInput };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setMessages(prev => [...prev, { role: 'ai', text: '...', isLoading: true }]);
    try {
      const rawResponse = await fetchChatResponse(messages.map(m => ({role: m.role, content: m.text})), userMsg.text);
      
      // 分离翻译
      const parts = rawResponse.split('|||');
      const frText = parts[0].trim();
      const enText = parts[1] ? parts[1].trim() : "";

      setMessages(prev => {
        const newMsgs = prev.filter(m => !m.isLoading);
        return [...newMsgs, { 
          role: 'ai', 
          text: frText, 
          translation: enText,
          showTranslation: false 
        }];
      });
      handleSpeak(frText);
    } catch (e) {
      setMessages(prev => prev.filter(m => !m.isLoading));
    }
  };

  const toggleTranslation = (idx) => {
    setMessages(prev => prev.map((msg, i) => 
      i === idx ? { ...msg, showTranslation: !msg.showTranslation } : msg
    ));
  };

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("此浏览器不支持语音输入，请使用 Chrome。");
      return;
    }
    const recognition = new window.webkitSpeechRecognition();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setChatInput(transcript);
    };
    recognition.start();
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
      {/* 顶部标题栏 (固定) */}
      <div className="bg-white/90 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 onClick={() => setActiveTab('search')} className="text-xl font-bold text-gray-900 flex items-center gap-2 tracking-tight cursor-pointer">
            <BookOpen size={22} className="text-blue-600" />
            FrenchMemo
          </h1>
          <div className="text-xs text-gray-400 font-medium font-mono">
             {greeting}, {user ? `Explorer` : 'Ami'}
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 py-8 h-full">
        
        {activeTab === 'chat' && (
          <ChatView 
            messages={messages} 
            chatInput={chatInput} 
            setChatInput={setChatInput} 
            handleSendChat={handleSendChat} 
            startListening={startListening} 
            isRecording={isRecording} 
            chatEndRef={chatEndRef}
            toggleTranslation={toggleTranslation}
          />
        )}

        {activeTab === 'album' && loading && (
           <div className="text-center py-20 flex flex-col items-center">
             <Loader2 className="animate-spin text-blue-600 mb-4" size={32} />
             <p className="text-gray-500">正在生成专辑...</p>
           </div>
        )}
        
        {activeTab === 'album' && !loading && albumData && (
          <AlbumView 
            data={albumData} 
            handleSearch={handleSearch} 
            favoriteAlbums={favoriteAlbums} 
            toggleFavoriteAlbum={toggleFavoriteAlbum} 
            setActiveTab={setActiveTab} 
          />
        )}

        {activeTab === 'search' && (
          <>
            {/* Hero Search Area */}
            <div className="relative mb-8 z-10">
              {!currentWordData && !loading && (
                <div className="text-center mb-6 pt-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <h2 className="text-3xl font-serif font-bold text-gray-800 mb-2">{greeting}.</h2>
                </div>
              )}
            
              <form onSubmit={handleSearch} className="relative group">
                <div className={`absolute inset-0 bg-blue-500/10 rounded-2xl blur-xl transition-opacity duration-500 ${loading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>
                <input 
                  type="text" 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  placeholder="Rechercher..." 
                  className="w-full pl-14 pr-14 py-5 bg-white border border-gray-100 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.04)] text-xl font-medium placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all relative z-10" 
                />
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300 z-20 group-focus-within:text-blue-500 transition-colors" size={24} />
                <button type="submit" disabled={loading} className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:opacity-70 hover:scale-105 active:scale-95 z-20 shadow-md">
                  {loading ? <Loader2 className="animate-spin" size={20} /> : <ArrowRight size={20} />}
                </button>
              </form>
            </div>

            {/* 首页浮动单词（杂志风极简版） */}
            {!currentWordData && !loading && (
               <FloatingWords onWordClick={(word) => handleSearch(null, word)} />
            )}

            {currentWordData && (
              <WordCard 
                data={currentWordData} 
                toggleFavoriteWord={toggleFavoriteWord} 
                favorites={favorites} 
                handleAlbumClick={handleAlbumClick} 
                handleSearch={handleSearch} 
              />
            )}
          </>
        )}

        {activeTab === 'favorites' && (
          <div className="space-y-8 pb-20">
            {favoriteAlbums.length > 0 && (
              <div className="mb-8">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">收藏的专辑</h3>
                <div className="grid grid-cols-2 gap-3">
                  {favoriteAlbums.map(album => (
                    <button key={album.id} onClick={() => handleAlbumClick(album.category)} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm text-left hover:border-blue-200 transition-all">
                      <div className="flex justify-between items-start">
                         <span className="font-bold text-gray-800">{album.category}</span>
                         <Layers size={16} className="text-blue-500" />
                      </div>
                      <span className="text-xs text-gray-400 mt-2 block">{album.items.length} words</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">收藏的单词</h3>
            {favorites.length === 0 ? (
              <div className="text-center py-10"><p className="text-gray-500 font-medium">暂无收藏单词</p></div>
            ) : (
              favorites.map(fav => (
                <WordCard 
                  key={fav.id} 
                  data={fav} 
                  toggleFavoriteWord={() => toggleFavoriteWord(fav)} 
                  favorites={favorites} 
                  onDelete={() => toggleFavoriteWord(fav)} 
                  handleAlbumClick={handleAlbumClick}
                  handleSearch={handleSearch}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* 底部导航栏 (固定) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-40 pb-safe">
        <div className="flex max-w-xl mx-auto">
          <button 
            onClick={() => setActiveTab('search')} 
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition-colors ${activeTab === 'search' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Search size={22} />
            <span className="text-[10px] font-medium">探索</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('chat')} 
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition-colors ${activeTab === 'chat' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <MessageCircle size={22} />
            <span className="text-[10px] font-medium">AI对话</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('favorites')} 
            className={`flex-1 py-3 flex flex-col items-center gap-1 transition-colors ${activeTab === 'favorites' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Star size={22} />
            <span className="text-[10px] font-medium">收藏</span>
          </button>
        </div>
      </div>
    </div>
  );
}