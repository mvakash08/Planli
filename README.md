# Planli — Personalized DSA Study Planner ⚡

> A modern, dynamic study planner designed for software engineers mastering Data Structures & Algorithms. Plan your preparation for **Striver's SDE Sheet (180 questions)** and **Striver's A-Z DSA Course (496 questions)** with realistic, sprint-based daily commitments, cloud sync, and progress tracking.

🌐 **Live Demo:** [https://planli-study.web.app](https://planli-study.web.app) | [https://planli-39e77.web.app](https://planli-39e77.web.app)

---

## ✨ Features

- 🎯 **Dual Curriculum Support**:
  - **Striver 180 SDE Sheet**: 179 curated problems across essential DSA patterns (3,938 estimated minutes).
  - **Striver A-Z DSA Course**: Comprehensive 496 topics & problems covering basics to advanced algorithms (11,518 estimated minutes).
- 📅 **Dynamic Smart Scheduler**:
  - Automatically calculates target completion date based on daily commitment (e.g. 1.5h, 2.2h, 3h, 4h/day).
  - Groups your schedule into 7-day milestone sprints.
  - Accommodates pause/rest dates and dynamically shifts remaining tasks forward without disrupting completed items.
  - Strict question-order preservation ensures foundational topics precede advanced ones.
- 🔐 **Flexible Multi-Method Authentication**:
  - **Google One-Click Sign-In** via Firebase Auth popup.
  - **Mobile Phone OTP** verification via SMS.
  - **Username/Email + Password** login and account creation.
- ☁️ **Cloud Synchronization & Local-First Resilience**:
  - Backed by **Google Cloud Firestore** for real-time sync across devices.
  - Built-in **IndexedDB fallback** for offline resilience.
- 📊 **Progress & Revision Tools**:
  - Track completed problems, mark difficult items for revision bookmarks, and attach personal markdown notes.
  - Real-time sprint progress bar and completion metrics.
  - Direct links to takeUforward practice pages.
- 🎨 **Polished Dark Mode UI**:
  - Minimalist aesthetic inspired by modern productivity apps.
  - Fully responsive across desktop, tablet, and mobile viewports.

---

## 🛠️ Tech Stack

- **Frontend:** React 18, Vite
- **Styling:** Vanilla CSS with custom modern design system & CSS variables
- **Backend & Auth:** Firebase Authentication (Google OAuth, Phone OTP, Email/Password), Cloud Firestore
- **Deployment:** Firebase Hosting
- **Testing:** Node.js built-in test runner (`node --test`)

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20 or newer
- npm 9 or newer

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mvakash08/planli.git
   cd planli
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Firebase:
   Copy or configure your credentials in `src/lib/firebase.js` or set up your own Firebase project with Authentication and Firestore enabled.

4. Start development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

## 🧪 Testing & Build

Run the test suite:
```bash
npm test
```

Build for production:
```bash
npm run build
```

Deploy to Firebase Hosting:
```bash
firebase deploy --only hosting
```

---

## 📄 License

MIT License. Built for showcase and personal study planning.
