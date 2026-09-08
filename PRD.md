# Product Requirements Document (PRD): "Dear Jee"

## 1. Project Overview
**Project Name:** Dear Jee
**Purpose:** A minimalist, aesthetically pleasing web application for long-distance couples to write, send, and read positive affirmations and love letters to each other. 
**Core Philosophy:** The app should feel intimate, warm, and nostalgic. It should mimic the emotional experience of receiving a physical, handwritten letter, but with the convenience of a modern web app.

## 2. Tech Stack
- **Frontend:** React 18+, TypeScript, Vite
- **Styling:** Tailwind CSS (for layout/utility), custom CSS for specific aesthetic touches (paper textures, handwriting fonts).
- **Animations:** Framer Motion (crucial for the "unfolding letter" and smooth transitions).
- **Backend/Database:** Supabase (PostgreSQL, Auth, Realtime).
- **Hosting:** Vercel.
- **Icons:** Lucide React.

## 3. UI/UX & Design System (CRITICAL FOCUS)
*The visual appeal is the most important part of this app. It must not look like a standard SaaS dashboard. It must look like a digital love letter.*

### A. Color Palette
Avoid harsh pure whites (`#FFFFFF`) and pure blacks (`#000000`). Use warm, paper-like tones.
- **Background (App):** Soft warm off-white / cream (`#FDFBF7` or `#F9F6F0`).
- **Background (Letter):** Slightly darker, textured paper tone (`#F4EFE6`).
- **Primary Text (UI):** Deep warm charcoal (`#2C2825`).
- **Primary Text (Letter Body):** Faded ink blue/black (`#1A1A1A` with 85% opacity).
- **Accent/Interactive:** Muted terracotta, dusty rose, or warm gold (`#C87963` or `#D4AF37`) for buttons and active states.

### B. Typography
- **App UI (Navigation, Buttons, Dates):** `Inter` or `Plus Jakarta Sans` (Clean, modern, highly readable).
- **Letter Body (The Affirmation):** `Lora` or `Playfair Display` (Elegant, romantic serif). we can add more fonts choices too for letter fonts in future. 
- **Sign-off / Sender Name:** `Caveat`, `Dancing Script`, or `Kalam` (A natural, readable handwriting font).

### C. Visual Elements & Textures
- **Paper Texture:** Apply a very subtle, low-opacity noise or paper texture overlay to the letter background so it doesn't look like a flat digital rectangle.
- **Shadows:** Use soft, diffused drop shadows (`shadow-xl` with low opacity and a warm tint) to make the letter look like it's resting on a desk.
- **Micro-interactions:** 
  - When a new letter arrives, it should gently "slide" into the inbox.
  - When opening a letter, use Framer Motion to simulate it unfolding or scaling up smoothly.
  - Hover states on buttons should have a soft, warm glow.

## 4. Database Schema (Supabase)
Keep it simple. Two main tables.

**Table: `profiles`**
- `id` (uuid, primary key, references auth.users)
- `full_name` (text)
- `partner_id` (uuid, references profiles.id) - *Links the two users together.*
- `created_at` (timestamp)

**Table: `letters`**
- `id` (uuid, primary key)
- `sender_id` (uuid, references profiles.id)
- `receiver_id` (uuid, references profiles.id)
- `message` (text) - *The affirmation/letter content.*
- `created_at` (timestamp)
- `is_read` (boolean, default false)
- share_slug (text, unique, nullable) - Used to generate the unlisted public URL (e.g., /letter/abc123).
- is_public (boolean, default false) - Toggles whether the letter can be viewed via the share link without logging in.

*Note for AI: Ensure Row Level Security (RLS) is set up so users can only insert letters where they are the sender, and only select letters where they are the receiver (or sender, for a "sent" folder).*

## 5. Core Features & User Flow

### A. Authentication
- Simple Email/Password login via Supabase Auth.
- On first login, prompt the user to enter their name and their partner's invite code (or just a simple setup flow where User A creates the account and shares a partner code with User B). *Keep it simple: just a setup screen to input names and link them.*

### B. The Inbox (Home)
- Displays a grid or list of received letters.
- Each letter preview shows: A snippet of the message, the date, and the sender's name (in the handwriting font).
- Unread letters have a subtle visual indicator (e.g., a small warm dot or slightly elevated shadow).

### C. The Letter View (Reading)
- Clicking a letter opens a modal or dedicated view.
- **Layout:** Centered on the screen, max-width of 600px. 
- **Header:** "Dear [Partner's Name]," (it is not compulsory to have this in layout)
- **Body:** The message text in the elegant serif font.
- **Footer:** "With love, [Sender's Name]" (in handwriting font) aligned to the right. Below it, the date in small, muted text.

### D. Compose (Writing)
- A clean, distraction-free writing area.
- A text area styled to look like a blank piece of paper.
- A prominent "Send Letter" button.
- Include a small character/word count, but keep it unobtrusive.

### E. Share & External Messaging (Copy Link)
Since LDR couples constantly use external apps (WhatsApp, iMessage, Telegram) to communicate, this feature allows them to share beautiful moments from the app seamlessly without breaking their daily texting flow.
Share Specific Letter (Digital Postcard): Allow users to generate a unique, unlisted URL for a specific letter. When the partner (or anyone) clicks the link, it opens the letter in a beautiful, read-only web view without requiring them to log in.
- Copy Link & Native Share:
A prominent "Copy Link" button on the Letter View.
Mobile optimization: Implement the native Web Share API. If the user is on mobile, tapping "Share" should open their native share sheet (allowing them to send it directly via iMessage, WhatsApp, etc.).
- Desktop fallback: If the Web Share API isn't available, copy the link to the clipboard.
UI/UX Touches:
Toast Notification: When the link is copied, show a warm, non-intrusive toast notification at the bottom of the screen: "Link copied! Send it to them on WhatsApp 💌"
- Micro-interaction: The share icon (using Lucide's Share2 or Link) should have a satisfying click animation (e.g., briefly turning into a checkmark Check with a soft terracotta glow).
Placement: Place the share button subtly in the top right corner of the Letter View modal, so it doesn't distract from the romantic reading experience.

## 6. Component Architecture
Please structure the React app with the following components:
- `Layout`: Main wrapper with the warm background color.
- `LetterCard`: The preview component for the inbox.
- `LetterModal` / `LetterView`: The expanded view for reading a letter.
- `ComposeLetter`: The form for writing a new affirmation.
- `AuthScreen`: Login/Signup and initial partner-linking setup.
- `PaperTexture`: A reusable background component for the letter backgrounds.

## 7. Execution Instructions for Claude Code
1. **Initialize:** Set up a Vite + React + TypeScript project. Install Tailwind CSS, Framer Motion, Supabase JS client, and Lucide React.
2. **Styling First:** Before building complex logic, set up the `tailwind.config.js` with the custom colors, fonts, and subtle paper texture utilities defined in Section 3. The aesthetic is the priority.
3. **Supabase Setup:** Create the `supabaseClient.ts` configuration file. Write the SQL schema for the tables and RLS policies as defined in Section 4.
4. **State & Data:** Use React Context or simple `useState`/`useEffect` (or React Query if preferred) to fetch letters. Keep data fetching simple and clean.
5. **Animations:** Implement Framer motion for the `LetterCard` hover effects and the `LetterModal` open/close transitions. Use `AnimatePresence`.
6. **Code Quality:** Ensure all components are strictly typed with TypeScript. Use functional components and hooks. Keep the code modular and well-commented.
7. **Responsive Design:** Ensure the letter looks beautiful on mobile (full width with padding) and desktop (centered, max-width constrained).

***

