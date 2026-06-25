"use client";

import React, { useState, useEffect } from "react";
import { Search, Bot, CheckCircle2, ChevronRight, Copy, RefreshCw, Moon, Sun, Database, FileText, Trash2, X, Plus } from "lucide-react";

interface Template {
  id?: string;
  content: string;
  source_file?: string;
  filename?: string;
  score?: number;
}

interface GenerateResponse {
  final_email?: string;
  proposed_outlines?: string[];
  llm_used: string;
  processing_time_ms: number;
}

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  const [showDbModal, setShowDbModal] = useState(false);
  const [managedTemplates, setManagedTemplates] = useState<Template[]>([]);

  // Database Tab States
  const [dbActiveTab, setDbActiveTab] = useState<"list" | "add">("list");
  const [newTplName, setNewTplName] = useState("");
  const [newTplContent, setNewTplContent] = useState("");
  const [isSavingTpl, setIsSavingTpl] = useState(false);

  const [llmChoice, setLlmChoice] = useState<"gemini" | "groq">("gemini");
  const [userInput, setUserInput] = useState("");
  const [manualTemplate, setManualTemplate] = useState("");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [outlines, setOutlines] = useState<string[]>([]);
  const [finalEmail, setFinalEmail] = useState("");
  const [stats, setStats] = useState({ llm: "", time: 0 });

  // UI States
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // AI Evaluation States
  type EvalStatus = "idle" | "evaluating" | "added" | "rejected" | "removed" | "failed" | "removing" | "adding" | "prompt_save";
  const [evalStatus, setEvalStatus] = useState<EvalStatus>("idle");
  const [evalReason, setEvalReason] = useState("");
  const [evalFilename, setEvalFilename] = useState("");
  const [customFilename, setCustomFilename] = useState("");

  const getApiUrl = () => {
    if (typeof window !== "undefined") {
      return `http://${window.location.hostname}:8000`;
    }
    return "http://localhost:8000";
  };

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setIsDarkMode(isDark);
  }, []);

  const toggleDarkMode = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove("dark");
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add("dark");
      setIsDarkMode(true);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/templates`);
      const data = await res.json();
      setManagedTemplates(data.templates || []);
    } catch (e) {
      console.error("Failed to fetch templates", e);
    }
  };

  const openDbManager = () => {
    fetchTemplates();
    setDbActiveTab("list");
    setShowDbModal(true);
  };

  const handleSaveNewTemplate = async () => {
    if (!newTplName.trim() || !newTplContent.trim()) return;
    setIsSavingTpl(true);
    try {
      const finalName = newTplName.trim().endsWith('.txt') ? newTplName.trim() : `${newTplName.trim()}.txt`;
      const res = await fetch(`${getApiUrl()}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: finalName, content: newTplContent }),
      });
      if (res.ok) {
        setNewTplName("");
        setNewTplContent("");
        setDbActiveTab("list"); // Switch back to the list
        fetchTemplates(); // Refresh the list
      } else {
        alert("Failed to save template.");
      }
    } catch (e) {
      console.error("Save error", e);
    } finally {
      setIsSavingTpl(false);
    }
  };

  const handleSearch = async () => {
    if (!userInput.trim()) return;
    setIsLoading(true);
    setExpandedTemplate(null);
    try {
      const res = await fetch(`${getApiUrl()}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userInput, limit: 3 }),
      });
      const data = await res.json();
      setTemplates(data.results || []);
      setStep(2);
    } catch (error) {
      console.error("Search failed:", error);
      alert("Failed to connect to backend. Is FastAPI running?");
    } finally {
      setIsLoading(false);
    }
  };

  const evaluateManualTemplate = async (text: string) => {
    setEvalStatus("evaluating");
    try {
      const res = await fetch(`${getApiUrl()}/evaluate_template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual_template: text })
      });
      const data = await res.json();
      
      if (data.llm_failed) {
        setEvalStatus("failed");
      } else if (data.added_to_db) {
        setEvalStatus("added");
        setEvalReason(data.reason);
        setEvalFilename(data.filename); // BUG FIX: Now we actually save the filename so we can delete it!
      } else {
        setEvalStatus("rejected");
        setEvalReason(data.reason);
      }
    } catch(e) {
      console.error(e);
      setEvalStatus("failed");
    }
  };

  const handleUndoSave = async () => {
    setEvalStatus("removing");
    try {
      const res = await fetch(`${getApiUrl()}/templates/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: evalFilename })
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Server failed to delete the file");
      }
      
      setEvalStatus("removed");
    } catch(e: any) {
      console.error("Undo Save Error:", e);
      setEvalStatus("added");
      setEvalReason(`Warning: Could not delete automatically (${e.message}). Please remove it via the Database Manager.`);
    }
  };

  const handleForceAdd = async () => {
    // Show prompt instead of immediately adding
    setEvalStatus("prompt_save");
    setCustomFilename(`manual_override_${Math.floor(Date.now() / 1000)}`);
  };

  const executeSave = async () => {
    setEvalStatus("adding");
    try {
      const finalName = customFilename.trim() || `manual_override_${Math.floor(Date.now() / 1000)}`;
      const finalNameWithExt = finalName.endsWith('.txt') ? finalName : `${finalName}.txt`;
      
      const res = await fetch(`${getApiUrl()}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          filename: finalNameWithExt,
          content: manualTemplate 
        })
      });
      if (res.ok) {
        setEvalStatus("added");
        setEvalReason("You manually forced this template into the database.");
        setEvalFilename(finalNameWithExt); // FIX: Save filename to state so "Undo" works!
        // Re-fetch templates so the DB Manager updates immediately
        fetchTemplates();
      } else {
         throw new Error("Failed to save");
      }
    } catch(e) {
      setEvalStatus("failed");
    }
  };

  const handleGenerate = async (payload: any) => {
    setIsLoading(true);
    setEvalStatus("idle");
    
    try {
      const res = await fetch(`${getApiUrl()}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: userInput,
          llm_choice: llmChoice,
          ...payload,
        }),
      });
      const data: GenerateResponse = await res.json();
      
      setStats({ llm: data.llm_used, time: data.processing_time_ms });

      if (data.proposed_outlines && data.proposed_outlines.length > 0) {
        setOutlines(data.proposed_outlines);
        setStep(3);
      } else if (data.final_email) {
        setFinalEmail(data.final_email);
        setStep(4);
        
        if (payload.manual_template) {
          evaluateManualTemplate(payload.manual_template);
        }
      }
    } catch (error) {
      console.error("Generation failed:", error);
      alert("Failed to connect to backend. Is FastAPI running?");
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(finalEmail);
  };

  const resetFlow = () => {
    setStep(1);
    setUserInput("");
    setTemplates([]);
    setOutlines([]);
    setFinalEmail("");
    setManualTemplate("");
    setEvalStatus("idle");
    setExpandedTemplate(null);
  };

  // Determine dynamic loading text
  const getLoadingText = () => {
    if (evalStatus === "adding") return "Saving to Database...";
    if (evalStatus === "removing") return "Removing from Database...";
    return "Agents are thinking...";
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a0a0a] text-slate-900 dark:text-slate-100 transition-colors duration-300">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10 transition-colors">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg text-slate-800 dark:text-white">
            <Bot className="w-6 h-6 text-blue-600 dark:text-blue-500" />
            Agentic Email Hub
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={openDbManager}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
            >
              <Database className="w-4 h-4" />
              <span className="hidden sm:inline">Database</span>
            </button>
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors">
              <button
                onClick={() => setLlmChoice("gemini")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  llmChoice === "gemini" ? "bg-white dark:bg-slate-700 shadow-sm text-blue-700 dark:text-blue-400" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Gemini
              </button>
              <button
                onClick={() => setLlmChoice("groq")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  llmChoice === "groq" ? "bg-white dark:bg-slate-700 shadow-sm text-orange-600 dark:text-orange-400" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Groq
              </button>
            </div>
            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
              aria-label="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* FIX: Using flex-wrap so elements dynamically drop to the next line instead of getting cut off by margins */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-8 pb-2">
          {["Intent", "Template Match", "AI Proposals", "Final Polish"].map((label, i) => (
            <React.Fragment key={label}>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                step > i + 1 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" :
                step === i + 1 ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-2 ring-blue-300 dark:ring-blue-600 ring-offset-2 dark:ring-offset-[#0a0a0a] shadow-sm scale-105 transform duration-200" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}>
                <span>{i + 1}</span>
                {label}
              </div>
              {i < 3 && <ChevronRight className="w-4 h-4 text-slate-400 dark:text-slate-600 flex-shrink-0 hidden sm:block" />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 sm:p-8 animate-in fade-in duration-500 transition-colors">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">What do you need to draft?</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6">Describe your situation. We will search the database for matching compliance guidelines or templates.</p>
            <textarea
              className="w-full h-32 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none mb-4 text-base text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
              placeholder="e.g., I need to tell John that he is violating section 12 and has 3 days to fix it..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
            />
            <button
              onClick={handleSearch}
              disabled={!userInput.trim() || isLoading}
              className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-blue-800 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-all shadow-sm"
            >
              {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              Search Database
            </button>
          </div>
        )}

        {}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setStep(1)} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors text-sm font-medium flex items-center">
                    &larr; Back
                  </button>
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Found Templates</h2>
                </div>
                <p className="text-slate-500 dark:text-slate-400 mt-1">Tap a template to expand it, or reject them to use AI directions.</p>
              </div>
              <button 
                onClick={() => handleGenerate({ selected_template: null })}
                className="px-4 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-900 dark:hover:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-medium transition-colors"
                disabled={isLoading}
              >
                Reject All
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates && templates.length > 0 ? templates.map((tpl) => {
                const isExpanded = expandedTemplate === tpl.id;
                return (
                  <div 
                    key={tpl.id} 
                    className={`bg-white dark:bg-slate-900 border ${isExpanded ? 'border-blue-400 dark:border-blue-500 shadow-md ring-1 ring-blue-400/30' : 'border-slate-200 dark:border-slate-800'} p-5 rounded-xl cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-all flex flex-col relative`}
                    onClick={() => setExpandedTemplate(isExpanded ? null : tpl.id!)}
                  >
                    <div className="absolute top-4 right-4 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold px-2 py-1 rounded">
                      Match: {((tpl.score || 0) * 100).toFixed(0)}%
                    </div>
                    
                    {/* FIX: Filename now breaks words normally when expanded instead of truncating! */}
                    <span className={`text-xs font-mono text-slate-500 dark:text-slate-400 mb-2 block pr-24 ${isExpanded ? 'whitespace-normal break-all' : 'truncate'}`}>
                      {tpl.source_file}
                    </span>
                    
                    {/* FIX: Content removes line-clamp when expanded */}
                    <p className={`text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap flex-grow mb-4 transition-all ${isExpanded ? '' : 'line-clamp-4'}`}>
                      {tpl.content}
                    </p>
                    
                    {/* FIX: Generating now ONLY happens if you click this specific button! */}
                    {isExpanded && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGenerate({ selected_template: tpl.content });
                        }}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors mt-auto animate-in fade-in zoom-in-95 duration-200 shadow-sm"
                      >
                        Use this Template
                      </button>
                    )}
                  </div>
                );
              }) : (
                <div className="col-span-2 p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-slate-500 dark:text-slate-400">No highly relevant templates found in Qdrant.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div>
              <div className="flex items-center gap-3">
                <button onClick={() => setStep(2)} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors text-sm font-medium flex items-center">
                  &larr; Back
                </button>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Bot className="w-6 h-6 text-indigo-600 dark:text-indigo-400" /> AI Directions
                </h2>
              </div>
              <p className="text-slate-500 dark:text-slate-400 mt-1">No template selected. Choose an AI direction or write a quick draft.</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {outlines.map((outline, idx) => (
                <button
                  key={idx}
                  onClick={() => handleGenerate({ selected_outline: outline })}
                  disabled={isLoading}
                  className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-xl hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-sm transition-all flex items-start gap-3 group"
                >
                  <div className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold mt-0.5 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    {idx + 1}
                  </div>
                  <span className="text-slate-700 dark:text-slate-300 text-sm md:text-base">{outline}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-4 my-6">
              <div className="h-px bg-slate-200 dark:bg-slate-800 flex-grow"></div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">OR Write Manual Override</span>
              <div className="h-px bg-slate-200 dark:bg-slate-800 flex-grow"></div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
              <textarea
                className="w-full h-24 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 transition-all resize-none mb-3 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
                placeholder="Type a quick bullet point or rough draft here..."
                value={manualTemplate}
                onChange={(e) => setManualTemplate(e.target.value)}
              />
              <button
                onClick={() => handleGenerate({ manual_template: manualTemplate })}
                disabled={!manualTemplate.trim() || isLoading}
                className="px-5 py-2 bg-slate-800 dark:bg-slate-100 hover:bg-slate-900 dark:hover:bg-white disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white dark:text-slate-900 rounded-lg text-sm font-medium transition-colors ml-auto block"
              >
                Draft Using My Text
              </button>
            </div>
          </div>
        )}

        {}
        {step === 4 && (
          <div className="animate-in fade-in duration-500">
            {/* Inline Loading Text for AI Database operations */}
            {(evalStatus === "evaluating" || evalStatus === "removing" || evalStatus === "adding") && (
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex items-center gap-3 mb-6">
                <RefreshCw className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-spin flex-shrink-0" />
                <span className="text-sm font-medium text-indigo-800 dark:text-indigo-300">
                  {evalStatus === "evaluating" && "AI Gatekeeper is evaluating your template for the database..."}
                  {evalStatus === "removing" && "Removing template from the database..."}
                  {evalStatus === "adding" && "Saving manual template to the database..."}
                </span>
              </div>
            )}

            {evalStatus === "prompt_save" && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-grow">
                  <h4 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-2">
                    Name your new template
                  </h4>
                  <input 
                    type="text" 
                    value={customFilename}
                    onChange={(e) => setCustomFilename(e.target.value)}
                    placeholder="e.g. policy_update"
                    className="w-full p-2 text-sm border border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-800 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex gap-2 mt-2 sm:mt-0">
                  <button onClick={() => setEvalStatus("rejected")} className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button onClick={executeSave} className="whitespace-nowrap px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm">
                    Save to DB
                  </button>
                </div>
              </div>
            )}

            {evalStatus === "added" && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-green-800 dark:text-green-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4"/> Saved to Database!
                  </h4>
                  <p className="text-sm text-green-700 dark:text-green-400 mt-1">{evalReason}</p>
                </div>
                <button onClick={handleUndoSave} className="whitespace-nowrap px-3 py-1.5 bg-green-100 dark:bg-green-800/50 hover:bg-green-200 dark:hover:bg-green-800 text-green-800 dark:text-green-300 text-xs font-bold rounded-lg transition-colors border border-green-300 dark:border-green-700 shadow-sm">
                  Undo & Delete
                </button>
              </div>
            )}

            {evalStatus === "rejected" && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
                    Template Not Saved
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">{evalReason}</p>
                </div>
                <button onClick={handleForceAdd} className="whitespace-nowrap px-3 py-1.5 bg-yellow-100 dark:bg-yellow-800/50 hover:bg-yellow-200 dark:hover:bg-yellow-800 text-yellow-800 dark:text-yellow-300 text-xs font-bold rounded-lg transition-colors border border-yellow-300 dark:border-yellow-700 shadow-sm">
                  Force Add Anyway
                </button>
              </div>
            )}

            {evalStatus === "removed" && (
              <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-6">
                <p className="text-sm text-slate-600 dark:text-slate-400 font-medium">Template successfully removed from Qdrant.</p>
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 overflow-hidden transition-colors">
              <div className="bg-gradient-to-r from-slate-800 to-slate-900 dark:from-slate-950 dark:to-black p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-green-400" /> Final Draft Ready
                </h2>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300 bg-slate-800/50 dark:bg-slate-900/50 px-3 py-1.5 rounded-full border border-slate-600 dark:border-slate-800">
                  <Bot className="w-4 h-4" />
                  {stats.llm.toUpperCase()} • {stats.time}ms
                </div>
              </div>
              <div className="p-6 sm:p-8">
                <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-6 whitespace-pre-wrap text-slate-700 dark:text-slate-300 font-medium leading-relaxed transition-colors">
                  {finalEmail}
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <button
                    onClick={copyToClipboard}
                    className="w-full sm:w-auto px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
                  >
                    <Copy className="w-4 h-4" /> Copy to Clipboard
                  </button>
                  <button
                    onClick={resetFlow}
                    className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
                  >
                    <RefreshCw className="w-4 h-4" /> Start New Email
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FIX: Global Overlay is now dynamic based on evalStatus vs isLoading */}
        {(isLoading || evalStatus === "adding" || evalStatus === "removing") && (
          <div className="fixed inset-0 bg-slate-900/20 dark:bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 border border-slate-200 dark:border-slate-800">
              <RefreshCw className="w-8 h-8 text-blue-600 dark:text-blue-500 animate-spin" />
              <p className="font-medium text-slate-700 dark:text-slate-300 animate-pulse">{getLoadingText()}</p>
            </div>
          </div>
        )}

        {/* Database Manager Modal */}
        {showDbModal && (
          <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6">
            <div className="bg-slate-50 dark:bg-slate-950 w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
              <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Database Manager
                </h2>
                <button onClick={() => setShowDbModal(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500">
                  <X className="w-5 h-5"/>
                </button>
              </div>
              
              {/* Database Tabs */}
              <div className="flex bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 pt-2">
                <button 
                  onClick={() => setDbActiveTab("list")}
                  className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors ${dbActiveTab === "list" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                >
                  Existing Templates
                </button>
                <button 
                  onClick={() => setDbActiveTab("add")}
                  className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-1 ${dbActiveTab === "add" ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                >
                  <Plus className="w-4 h-4" /> Add New
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-grow space-y-6">
                {dbActiveTab === "list" ? (
                  <div>
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2"><FileText className="w-4 h-4"/> Existing Templates ({managedTemplates.length})</h3>
                    <div className="grid grid-cols-1 gap-3">
                      {managedTemplates.map((t, i) => (
                        <div key={i} className="p-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 group relative">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 block pr-8 truncate">{t.filename}</span>
                            <button 
                              onClick={async () => {
                                try {
                                  // Instantly remove from UI for visual snappiness
                                  setManagedTemplates(prev => prev.filter(tmpl => tmpl.filename !== t.filename));
                                  const res = await fetch(`${getApiUrl()}/templates/delete`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ filename: t.filename })
                                  });
                                  if (!res.ok) fetchTemplates();
                                } catch (e) { console.error("Failed to delete", e); fetchTemplates(); }
                              }}
                              className="opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded transition-all absolute right-2 top-2"
                              title="Delete Template"
                            >
                              <Trash2 className="w-4 h-4"/>
                            </button>
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{t.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Template Name</label>
                      <input 
                        type="text" 
                        placeholder="e.g. out_of_office_policy"
                        value={newTplName}
                        onChange={(e) => setNewTplName(e.target.value)}
                        className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Template Content</label>
                      <textarea 
                        placeholder="Write your standard email template or policy here..."
                        value={newTplContent}
                        onChange={(e) => setNewTplContent(e.target.value)}
                        className="w-full h-48 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 transition-all text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 resize-none"
                      />
                    </div>
                    <button 
                      onClick={handleSaveNewTemplate}
                      disabled={!newTplName.trim() || !newTplContent.trim() || isSavingTpl}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 dark:disabled:bg-indigo-800 text-white font-bold rounded-lg transition-colors flex justify-center items-center gap-2 shadow-sm"
                    >
                      {isSavingTpl ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
                      Save & Add to Database
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}