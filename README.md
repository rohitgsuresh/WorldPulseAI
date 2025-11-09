# 🌍 WorldPulse AI  
**Global Sentiment Intelligence Powered by Google Gemini**

![Architecture Diagram](A_flowchart_in_a_digital_vector_graphic_illustrate.png)

---

## 💡 Inspiration
We live in a hyper-connected world—but understanding global sentiment still feels fragmented.  
To gauge how nations feel about critical issues like education, climate, or food security, you must parse thousands of articles, posts, and reports.  
**WorldPulse** was created to simplify that — to let you *see the world’s pulse in one glance.*

---

## 🌐 What It Does
WorldPulse analyzes **real-time global sentiment** for any topic using **Google Gemini AI**.  
It visualizes sentiment intensity across **100 countries** on an interactive 3D globe, color-coded by polarity:

- 🟢 **≥ 0.5** – Stable / Improving  
- 🟡 **0.0 to < 0.5** – Mixed / Watch  
- 🟠 **-0.5 to < 0.0** – High Concern  
- 🔴 **< -0.5** – Crisis / Severe Stress  

Users can:
- Search for any global topic (e.g. *education, climate change, poverty*).  
- Jump to a specific country (e.g. *Finland*).  
- View instant summaries, scores, and keywords per country.  
- Bookmark and revisit important analyses.  
- Reset the world state anytime via **Clear**.

---

## 🧠 How We Built It
WorldPulse combines **AI, visualization, and interactivity** into one unified system.

### Frontend
- **HTML + CSS (Space Mono UI theme)**  
- **Globe.gl (Three.js)** for the 3D rotating Earth  
- **JavaScript** for dynamic data fetching, animations, and event control  
- A **cinematic intro screen** inspired by Google Earth  

### Backend
- **FastAPI** (Python) hosted on **Google Cloud Run**  
- **Google Vertex AI (Gemini 1.5 & 2.5 Flash)** models for real-time sentiment and summarization  
- **Async processing** using Python’s `asyncio` and `ThreadPoolExecutor` for parallel country requests  
- Built-in **CORS** for cross-origin web access  

### Infrastructure
- **Google Cloud Console** development  
- **Service Account Authentication** via metadata token  
- **GitHub** for version control  
- **Deployed backend endpoint:**  


---

## ⚙️ Challenges We Ran Into
- **Latency:** Fetching AI insights for 100 countries caused long waits.  
→ Solved by **concurrent async calls** and showing data **incrementally** as each country returns.  
- **Authentication issues** with Cloud Run’s metadata token during deployment.  
→ Fixed using `Metadata-Flavor: Google` headers and scoped IAM permissions.  
- **Dynamic visualization sync:** ensuring the globe updates as soon as each AI result arrives rather than waiting for all.  

---

## 🏆 Accomplishments We’re Proud Of
- Built a fully functioning **AI-powered world analyzer** from scratch in days.  
- Achieved a **smooth cinematic user experience** blending design and intelligence.  
- Enabled **Gemini to behave as a geopolitical analyst** through advanced system prompts.  
- Integrated **real-time visual feedback** — the globe lights up dynamically as insights stream in.

---

## 📚 What We Learned
- Mastered **Vertex AI API structure** and **Gemini JSON schema responses**.  
- Learned to optimize AI calls with **async concurrency**.  
- Understood how to **bridge AI reasoning with visualization** — turning abstract data into emotion.  

---

## 🚀 What’s Next for WorldPulse
- Add **time-series graphs and trend modals** for historical insight.  
- Integrate **news source citations** and external evidence linking.  
- Expand to **195 countries** with automatic data refresh.  
- Introduce **regional trend forecasting** and **crisis alerts**.  

---

## 🛠️ Built With
| Type | Technology |
|------|-------------|
| **Frontend** | HTML, CSS, JavaScript, Globe.gl, Three.js |
| **Backend** | Python, FastAPI |
| **Cloud Services** | Google Cloud Run, Vertex AI (Gemini) |
| **AI Models** | `gemini-2.5-flash`, `gemini-1.5-flash` |
| **Database / Storage** | Google Cloud Metadata Token (auth) |
| **Version Control** | Git + GitHub |

---

## 🧭 Repository & Links
- **Repo:** [github.com/rohitgsuresh/WorldPulseAI](https://github.com/rohitgsuresh/WorldPulseAI)  
- **Live Demo:** https://worldpulse-api-1014603752331.asia-southeast1.run.app  
- **Architecture Diagram:** included above

---

> *WorldPulse — Seeing the world’s emotions, one nation at a time.*
