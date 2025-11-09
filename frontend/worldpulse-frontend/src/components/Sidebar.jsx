import React from "react";

export default function Sidebar({ info, topic }) {
  if (!info) {
    return (
      <div className="flex flex-col text-white/60 text-sm h-full justify-center items-center text-center px-4">
        <div className="mb-2 text-white/80 font-medium text-base">
          No country selected
        </div>
        <div>
          Search a topic like{" "}
          <span className="text-accent">"food insecurity"</span> or{" "}
          <span className="text-accent">"water scarcity"</span>, then click a
          country.
        </div>
      </div>
    );
  }

  const score = info.sentiment_score ?? 0;
  const formattedScore = score.toFixed(2);

  // map score to color/status
  let moodColor = "text-neutral";
  let moodLabel = "Mixed";

  if (score <= -0.4) {
    moodColor = "text-danger";
    moodLabel = "Critical concern";
  } else if (score >= 0.4) {
    moodColor = "text-ok";
    moodLabel = "Positive / improving";
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="mb-4">
        <div className="text-white/50 text-xs uppercase tracking-wider">
          Country
        </div>
        <div className="text-xl font-semibold text-white leading-tight">
          {info.country}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="bg-panelDark/70 border border-white/10 rounded-card p-3">
          <div className="text-[10px] uppercase text-white/40 tracking-wide">
            Topic
          </div>
          <div className="text-white text-sm font-medium">{topic}</div>
        </div>

        <div className="bg-panelDark/70 border border-white/10 rounded-card p-3">
          <div className="text-[10px] uppercase text-white/40 tracking-wide">
            Sentiment score
          </div>
          <div
            className={`text-base font-semibold ${moodColor}`}
            title="Range -1 (bad) to +1 (good)"
          >
            {formattedScore}
          </div>
          <div className="text-[11px] text-white/40">{moodLabel}</div>
        </div>
      </div>

      <div className="mb-4 bg-panelDark/70 border border-white/10 rounded-card p-4">
        <div className="text-[10px] uppercase text-white/40 tracking-wide mb-1">
          Situation
        </div>
        <div className="text-white/90 text-sm leading-relaxed">
          {info.summary}
        </div>
      </div>

      <div className="mb-4 bg-panelDark/70 border border-white/10 rounded-card p-4">
        <div className="text-[10px] uppercase text-white/40 tracking-wide mb-2">
          Keywords
        </div>
        <div className="flex flex-wrap gap-2">
          {(info.keywords || []).map((k, i) => (
            <span
              key={i}
              className="text-xs bg-white/5 border border-white/10 text-white/80 rounded-full px-2 py-1"
            >
              {k}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-auto text-[10px] text-white/30 pt-4 border-t border-white/10">
        Data is AI-generated per country in real time using Google Cloud Run +
        Gemini. Scores: -1 = crisis, +1 = improving.
      </div>
    </div>
  );
}
