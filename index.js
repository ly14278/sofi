
import React, { useState, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import { Document, Packer, Paragraph, TextRun } from 'docx';
import saveAs from 'file-saver';

// --- Constants ---
const API_KEY = process.env.API_KEY;
const WORD_TYPES_MAP = {
  Noun: '名词',
  Verb: '动词',
  Adjective: '形容词',
  Adverb: '副词',
  Preposition: '介词',
  Conjunction: '连词',
};
const WORD_TYPES = Object.keys(WORD_TYPES_MAP);
const OPTION_KEYS = ['A', 'B', 'C', 'D'];


// --- Main App Component ---
const App = () => {
  const [inputText, setInputText] = useState('');
  const [numBlanks, setNumBlanks] = useState(10);
  const [selectedWordTypes, setSelectedWordTypes] = useState(new Set(['Noun', 'Verb', 'Adjective']));
  const [clozeTest, setClozeTest] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAnswers, setShowAnswers] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedWordIndices, setSelectedWordIndices] = useState(new Set());
  const [isEditingQuestions, setIsEditingQuestions] = useState(false);


  const ai = useMemo(() => new GoogleGenAI({ apiKey: API_KEY }), []);
  const wordsInText = useMemo(() => inputText.split(/([^\w'-]+)/).filter(part => part.trim() !== '' && part.match(/[a-zA-Z]/)), [inputText]);

  useEffect(() => {
    setSelectedWordIndices(new Set());
  }, [inputText]);
  
  useEffect(() => {
    if (!isEditMode) {
      setSelectedWordIndices(new Set());
    }
  }, [isEditMode]);

  const handleWordTypeChange = (type) => {
    setSelectedWordTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  const handleGenerate = async () => {
    const hasSufficientInput = isEditMode ? selectedWordIndices.size > 0 : inputText.trim();
    if (!hasSufficientInput || isLoading) return;

    setIsLoading(true);
    setError('');
    setClozeTest(null);
    setShowAnswers(false);
    setIsEditingQuestions(false);

    let prompt;
    if (isEditMode && selectedWordIndices.size > 0) {
        const selectedWords = Array.from(selectedWordIndices).map(i => wordsInText[i]);
        const expectedCount = selectedWords.length;
        prompt = `
You are an expert English teacher creating educational materials. Your task is to generate a cloze test from the given English text and return it as a valid JSON object.

**CRITICAL: JSON FORMATTING RULES**
1.  Your ENTIRE output MUST be a single, valid JSON object. Do not include any text, notes, or markdown like \`\`\`json before or after the JSON object.
2.  All strings within the JSON object (e.g., in the "passage" or "options") MUST be correctly escaped. For example, any double quotes " inside a string must be represented as \\". This is the most important rule to prevent errors.

**Instructions for the test:**
1.  Generate a cloze test with EXACTLY ${expectedCount} questions.
2.  From the full text provided below, you MUST remove ONLY the following specific words: "${selectedWords.join('", "')}". These are the only words to be turned into blanks. Do not remove any other words.
3.  Replace each of these removed words with a numbered blank formatted as "___[number]___", ensuring the numbering is sequential from 1 to ${expectedCount}.
4.  For each blank, create a multiple-choice question with 4 options (A, B, C, D). One option must be the correct word. The other three options must be plausible distractors of the same word type.
5.  The 'questions' array in the JSON MUST contain exactly ${expectedCount} question objects.

The JSON object must follow this exact structure:
{
  "passage": "The full text with your specified words replaced by numbered blanks, with all special characters correctly escaped.",
  "questions": [
    {
      "blankNumber": 1,
      "options": { "A": "word", "B": "word", "C": "word", "D": "word" },
      "correctAnswer": "A",
      "originalWord": "word"
    }
  ]
}

English Text to Process:
---START TEXT---
${inputText}
---END TEXT---
      `;
    } else {
       prompt = `
You are an expert English teacher creating educational materials. Your task is to generate a cloze test from the given English text and return it as a valid JSON object.

**CRITICAL: JSON FORMATTING RULES**
1.  Your ENTIRE output MUST be a single, valid JSON object. Do not include any text, notes, or markdown like \`\`\`json before or after the JSON object.
2.  All strings within the JSON object (e.g., in the "passage" or "options") MUST be correctly escaped. For example, any double quotes " inside a string must be represented as \\". This is the most important rule to prevent errors.

**Instructions for the test:**
1.  From the text provided below, remove exactly ${numBlanks} words.
2.  Prioritize removing words of the following types: ${[...selectedWordTypes].join(', ')}.
3.  Replace each removed word with a numbered blank formatted as "___[number]___".
4.  For each blank, create a multiple-choice question with 4 options (A, B, C, D). One option must be the correct original word. The other three options must be plausible distractors, preferably of the same word type as the original word.
5.  Distribute the correct answers (A, B, C, D) as evenly and randomly as possible across all questions.

The JSON object must follow this exact structure:
{
  "passage": "The full text with numbered blanks, with all special characters correctly escaped.",
  "questions": [
    {
      "blankNumber": 1,
      "options": { "A": "word", "B": "word", "C": "word", "D": "word" },
      "correctAnswer": "A",
      "originalWord": "word"
    }
  ]
}

English Text to Process:
---START TEXT---
${inputText}
---END TEXT---
      `;
    }

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-04-17",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      let jsonStr = response.text.trim();
      const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
      const match = jsonStr.match(fenceRegex);
      if (match && match[2]) {
        jsonStr = match[2].trim();
      }

      const resultData = JSON.parse(jsonStr);
      
      if (!resultData.passage || !Array.isArray(resultData.questions)) {
        throw new Error("Received invalid data structure from API.");
      }
      
      setClozeTest(resultData);
    } catch (e) {
      console.error(e);
      let errorMessage = '生成失败。请检查输入或稍后重试。';
      if (e instanceof Error) {
        errorMessage += ` 错误详情: ${e.message}`;
        if (e.message.toLowerCase().includes('json')) {
            errorMessage += ` (这通常意味着AI返回的数据格式不正确，可能是因为原文中的特殊字符（如引号）导致的。请尝试修改原文或重试。)`;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportToWord = () => {
    if (!clozeTest) return;

    const passageParagraphs = clozeTest.passage.split('\n').map(p => new Paragraph({
        children: p.split(/(___\d+___)/g).map(part => {
            const isBlank = part.match(/___\d+___/);
            return new TextRun({
                text: part,
                bold: isBlank,
            });
        }),
        spacing: { after: 200 }
    }));

    const questionParagraphs = clozeTest.questions.sort((a,b) => a.blankNumber - b.blankNumber).flatMap(q => {
        return [
            new Paragraph({
                children: [new TextRun({ text: `${q.blankNumber}. `, bold: true })]
            }),
            new Paragraph({ text: `   A. ${q.options.A}`, indent: { left: 720 } }),
            new Paragraph({ text: `   B. ${q.options.B}`, indent: { left: 720 } }),
            new Paragraph({ text: `   C. ${q.options.C}`, indent: { left: 720 } }),
            new Paragraph({ text: `   D. ${q.options.D}`, indent: { left: 720 } }),
            new Paragraph({ text: '' }), // Spacer
        ];
    });

    const answerKey = clozeTest.questions.sort((a,b) => a.blankNumber - b.blankNumber).map((q, i) => `${q.blankNumber}.${q.correctAnswer}`).join('  ');

    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({ text: '完形填空', heading: 'Heading1' }),
                ...passageParagraphs,
                new Paragraph({ text: '选择题', heading: 'Heading1' }),
                ...questionParagraphs,
                new Paragraph({ text: '答案', heading: 'Heading1' }),
                new Paragraph({ text: answerKey }),
            ],
        }],
    });

    Packer.toBlob(doc).then(blob => {
        saveAs(blob, 'cloze-test.docx');
    });
  };

  const toggleWordSelection = (index) => {
    setSelectedWordIndices(prev => {
        const newSet = new Set(prev);
        if (newSet.has(index)) {
            newSet.delete(index);
        } else {
            newSet.add(index);
        }
        return newSet;
    });
  };
  
  const renderClickableText = () => {
      const parts = inputText.split(/([^\w'-]+)/);
      let wordIdx = -1;
      return parts.map((part, i) => {
        if (part.trim() !== '' && part.match(/[a-zA-Z]/)) {
          wordIdx++;
          const currentWordIdx = wordIdx;
          const isSelected = selectedWordIndices.has(currentWordIdx);
          return (
            <span
              key={i}
              className={`clickable-word ${isSelected ? 'selected' : ''}`}
              onClick={() => toggleWordSelection(currentWordIdx)}
            >
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      });
  };

  const handleOptionChange = (blankNumber, optionKey, value) => {
    setClozeTest(prev => {
        if (!prev) return null;
        const newQuestions = prev.questions.map(q => {
            if (q.blankNumber === blankNumber) {
                const newOptions = { ...q.options, [optionKey]: value };
                return { ...q, options: newOptions };
            }
            return q;
        });
        return { ...prev, questions: newQuestions };
    });
  };

  const handleCorrectAnswerChange = (blankNumber, value) => {
      setClozeTest(prev => {
          if (!prev) return null;
          const newQuestions = prev.questions.map(q => {
              if (q.blankNumber === blankNumber) {
                  return { ...q, correctAnswer: value };
              }
              return q;
          });
          return { ...prev, questions: newQuestions };
      });
  };

  return (
    <div className="container">
      <header>
        <h1>智能完形填空生成器</h1>
        <p>粘贴英文文章，选择参数，即可生成一篇完形填空练习题。</p>
      </header>

      <main className="main-content">
        <div className="card settings-panel">
          <h2>设置</h2>
          <div className="form-group">
            <label htmlFor="text-input">1. 粘贴英文原文</label>
            <div className="edit-mode-toggle">
                <span>自动模式</span>
                <label className="switch">
                    <input type="checkbox" checked={isEditMode} onChange={() => setIsEditMode(!isEditMode)} />
                    <span className="switch-slider"></span>
                </label>
                <span>编辑模式</span>
            </div>
            {isEditMode ? (
              <div className="clickable-text-container" aria-label="可点击的文本区域，用于选择单词">
                {inputText ? renderClickableText() : <textarea id="text-input" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="在这里粘贴您的英文文章以开始..." rows={8}></textarea>}
              </div>
            ) : (
              <textarea
                id="text-input"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="在这里粘贴您的英文文章..."
                aria-label="英文原文输入框"
              />
            )}
          </div>
          
          {!isEditMode && (
            <>
              <div className="form-group">
                <label>2. 设置题目数量: {numBlanks}</label>
                <div className="slider-container">
                  <span>1</span>
                  <input type="range" min="1" max="20" value={numBlanks} onChange={(e) => setNumBlanks(Number(e.target.value))} aria-label="题目数量滑块" />
                  <span>20</span>
                </div>
              </div>
              <div className="form-group">
                <label>3. 选择优先挖空的词性</label>
                <div className="word-types">
                  {WORD_TYPES.map(type => (
                    <label key={type}> <input type="checkbox" checked={selectedWordTypes.has(type)} onChange={() => handleWordTypeChange(type)} /> <span>{type} ({WORD_TYPES_MAP[type]})</span> </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {isEditMode && (
             <div className="form-group">
                <label>2. 点击上方文本中的单词进行选择</label>
                <p className="edit-mode-info">已选择 {selectedWordIndices.size} 个单词。完成后请点击“开始生成”。</p>
            </div>
          )}
          
          <button onClick={handleGenerate} disabled={isLoading || (isEditMode ? selectedWordIndices.size === 0 : !inputText.trim())} className="generate-btn">
            {isLoading ? '生成中...' : '开始生成'}
          </button>

          <div className="friendly-links">
            <h3>友情链接 (推荐阅读)</h3>
            <ul>
              <li><a href="https://learningenglish.voanews.com/" target="_blank" rel="noopener noreferrer">VOA Learning English</a></li>
              <li><a href="https://www.bbc.co.uk/learningenglish" target="_blank" rel="noopener noreferrer">BBC Learning English</a></li>
              <li><a href="https://breakingnewsenglish.com/" target="_blank" rel="noopener noreferrer">Breaking News English</a></li>
            </ul>
          </div>
        </div>

        <div className="card result-panel">
          {isLoading ? (
            <div className="loader" aria-label="加载中"></div>
          ) : error ? (
            <p className="error-message">{error}</p>
          ) : clozeTest ? (
            <div className="cloze-result">
              <div className="cloze-passage" aria-label="完形填空文章">
                {clozeTest.passage.split(/(___\d+___)/g).map((part, index) => part.match(/___\d+___/) ? <b key={index}>{part}</b> : part)}
              </div>
              <div className="questions-header">
                <h3>选择题</h3>
                <div className="header-buttons">
                    <button onClick={() => setIsEditingQuestions(!isEditingQuestions)} className="toggle-answers-btn">
                      {isEditingQuestions ? '完成编辑' : '编辑题目'}
                    </button>
                    <button onClick={() => setShowAnswers(!showAnswers)} className="toggle-answers-btn">
                      {showAnswers ? '隐藏答案' : '显示答案'}
                    </button>
                    <button onClick={handleExportToWord} className="toggle-answers-btn">
                      导出为 Word
                    </button>
                </div>
              </div>
              <ul className="question-list">
                {clozeTest.questions.sort((a,b) => a.blankNumber - b.blankNumber).map(q => (
                  <li key={q.blankNumber} className="question-item">
                    <div className="question-number">{q.blankNumber}.</div>
                    {isEditingQuestions ? (
                        <div className="options-list editing">
                            {OPTION_KEYS.map(key => (
                                <div className="option-edit" key={key}>
                                    <label htmlFor={`q${q.blankNumber}-${key}`}>{key}.</label>
                                    <input 
                                        type="text" 
                                        id={`q${q.blankNumber}-${key}`} 
                                        value={q.options[key]}
                                        onChange={(e) => handleOptionChange(q.blankNumber, key, e.target.value)}
                                    />
                                </div>
                            ))}
                            <div className="correct-answer-edit">
                                <label htmlFor={`q${q.blankNumber}-correct`}>正确答案:</label>
                                <select 
                                    id={`q${q.blankNumber}-correct`}
                                    value={q.correctAnswer} 
                                    onChange={(e) => handleCorrectAnswerChange(q.blankNumber, e.target.value)}
                                >
                                    {OPTION_KEYS.map(key => <option key={key} value={key}>{key}</option>)}
                                </select>
                            </div>
                        </div>
                    ) : (
                        <div className="options-list">
                          {OPTION_KEYS.map(key => (
                            <div key={key} className={`option ${showAnswers && key === q.correctAnswer ? 'correct' : ''}`} aria-label={`选项 ${key}: ${q.options[key]}`}>
                              {key}. {q.options[key]}
                            </div>
                          ))}
                        </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="result-placeholder">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="m15 5 3 3"/></svg>
              <p>结果将在这里显示</p>
            </div>
          )}
        </div>
      </main>

      <footer>
        <p>For Ms. sofi</p>
      </footer>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
