import React, { useState, useEffect } from "react";
import GlobeView from "./components/GlobeView.jsx";
import Sidebar from "./components/Sidebar.jsx";
import SearchBar from "./components/SearchBar.jsx";

const API_URL = "https://worldpulse-api-1014603752331.asia-southeast1.run.app";

export default function App() {
  const [topic, setTopic] = useState("air pollution");
  const [data, setData] = useState([]); // array of countries from API
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // fetch world sentiment for a topic
  const fetchData = async (t) => {
    try {
      setIsLoading(true);
      const res = await fetch(
        `${API_URL}/sentiment?topic=${encodeURIComponent(t)}`
      );
      const json = await res.json();
      setData(json.results || []);
      setSelectedCountry(null);
      setIsLoading(false);
    } catch (err) {
      console.error("fetch error", err);
      setIsLoading(false);
    }
  };

  // load once on mount
  useEffect(() => {
    fetchData(topic);
  }, []);

  // what happens when you click a country on the globe
  const handleSelectCountry = (countryName) => {
    const match = data.find((c) => c.country === countryName);
    if (match) {
      setSelectedCountry(match);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col text-white">
      {/* header bar */}
      <header className="p-4 flex items-center justify-between bg-panelDark/40 backdrop-blur-lg border-b border-white/10 shadow-glow">
        <div className="flex flex-col">
          <span className="text-sm text-white/50 tracking-wider uppercase">
            WorldPulse
          </span>
          <span className="text-lg font-medium text-white">
            Global Sentiment Intelligence
          </span>
        </div>

        <SearchBar
          topic={topic}
          setTopic={setTopic}
          onSearch={() => fetchData(topic)}
          loading={isLoading}
        />
      </header>

      {/* main content */}
      <main className="flex-1 flex flex-row overflow-hidden">
        {/* globe area */}
        <section className="flex-1 relative">
          <GlobeView
            data={data}
            onSelectCountry={handleSelectCountry}
            selectedCountryName={selectedCountry?.country}
          />

          {/* subtle instruction overlay */}
          <div className="absolute left-4 bottom-4 text-xs text-white/60 bg-black/40 backdrop-blur-md px-3 py-2 rounded-card border border-white/10">
            Click a country to inspect sentiment.
          </div>
        </section>

        {/* sidebar */}
        <aside className="w-[340px] max-w-[340px] bg-panelDark/60 backdrop-blur-xl border-l border-white/10 shadow-glow p-4 flex flex-col">
          <Sidebar info={selectedCountry} topic={topic} />
        </aside>
      </main>
    </div>
  );
}
