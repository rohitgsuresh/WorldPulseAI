import React, { useRef, useEffect, useState, useMemo } from "react";
import Globe from "react-globe.gl";

// lightweight world countries geojson
const WORLD_GEOJSON_URL =
  "https://unpkg.com/world-atlas@2/countries-110m.json";

export default function GlobeView({
  data,
  onSelectCountry,
  selectedCountryName,
}) {
  const globeRef = useRef();
  const [geoJson, setGeoJson] = useState(null);

  // load world geometry once
  useEffect(() => {
    fetch(WORLD_GEOJSON_URL)
      .then((res) => res.json())
      .then((worldData) => {
        // worldData is topojson, react-globe.gl can take polygons in GeoJSON form
        // we'll convert countries to features with name lookups via "name" from a lookup table
        // For hackathon: we'll just attach name using a tiny static lookup we control below
        import("topojson-client").then(({ feature }) => {
          const countries = feature(
            worldData,
            worldData.objects.countries
          ).features;
          setGeoJson(countries);
        });
      });
  }, []);

  // simple name resolver: you can extend this map if some names don't match.
  // keys = what topojson uses, values = what your API returns.
  const countryNameMap = useMemo(
    () => ({
      India: "India",
      Singapore: "Singapore",
      "United States of America": "USA",
      Kenya: "Kenya"
    }),
    []
  );

  // map each polygon to sentiment data
  const polygons = useMemo(() => {
    if (!geoJson) return [];

    return geoJson.map((feature) => {
      const topoName = feature.properties.name;
      const mappedName = countryNameMap[topoName];
      const match = data.find((c) => c.country === mappedName);

      const score = match ? match.sentiment_score : null;

      // color logic:
      // negative -> red-ish glow
      // positive -> green-ish glow
      // neutral -> bluish/gray
      let color = "rgba(107,114,128,0.6)"; // neutral gray
      if (score !== null && score <= -0.4) {
        color = "rgba(239,68,68,0.7)"; // red-500-ish
      } else if (score !== null && score >= 0.4) {
        color = "rgba(16,185,129,0.7)"; // green-500-ish
      } else if (score !== null) {
        color = "rgba(56,189,248,0.6)"; // cyan-ish for mixed
      }

      return {
        ...feature,
        properties: {
          ...feature.properties,
        },
        _displayName: mappedName || topoName,
        _score: score,
        _color: color
      };
    });
  }, [geoJson, data, countryNameMap]);

  // spin/glow styling
  useEffect(() => {
    if (globeRef.current) {
        globeRef.current.controls().autoRotate = true;
        globeRef.current.controls().autoRotateSpeed = 0.6;
    }
  }, [globeRef]);

  return (
    <div className="w-full h-full relative">
      <Globe
        ref={globeRef}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        polygonsData={polygons}
        polygonAltitude={d =>
          d._displayName === selectedCountryName ? 0.06 : 0.03
        }
        polygonCapColor={d => d._color}
        polygonSideColor={() => "rgba(0, 0, 0, 0.3)"}
        polygonStrokeColor={() => "rgba(0, 0, 0, 0.6)"}
        onPolygonClick={d => {
          if (d && d._displayName) {
            onSelectCountry(d._displayName);
          }
        }}
        polygonsTransitionDuration={300}
      />

      {/* hover info bubble / legend */}
      <div className="absolute right-4 bottom-4 text-[10px] leading-relaxed text-white/60 bg-black/40 backdrop-blur-md px-3 py-2 rounded-card border border-white/10">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-[rgb(239,68,68)]"></span>
          <span>High stress / crisis</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-[rgb(56,189,248)]"></span>
          <span>Mixed concern</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-[rgb(16,185,129)]"></span>
          <span>Improving / stable</span>
        </div>
      </div>
    </div>
  );
}
