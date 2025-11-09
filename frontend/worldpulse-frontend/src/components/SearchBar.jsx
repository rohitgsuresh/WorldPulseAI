import React from "react";

export default function SearchBar({ topic, setTopic, onSearch, loading }) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="bg-panelDark/80 text-white text-sm px-3 py-2 rounded-card border border-white/10 outline-none focus:ring-2 focus:ring-accent/60 placeholder-white/30 min-w-[200px]"
        placeholder="Ask about a topic (e.g. food security)"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !loading) onSearch();
        }}
      />
      <button
        onClick={onSearch}
        disabled={loading}
        className="text-sm font-medium bg-accent text-black rounded-card px-4 py-2 shadow-glow border border-accent/30 hover:bg-accent/90 disabled:opacity-40"
      >
        {loading ? "Analyzing..." : "Analyze"}
      </button>
    </div>
  );
}
