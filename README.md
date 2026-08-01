# Visual Anagrams Batch Generator

Local web app that queues visual-anagram jobs and processes them in batches via a Google Colab notebook. The app and Colab worker sync through Google Drive.

**App URL:** [http://localhost:2222](http://localhost:2222)

## Installation

**Prerequisites:** [Node.js](https://nodejs.org/) 20+ and npm.

```bash
git clone <repo-url> GengEtal
cd GengEtal
npm run install:all
cp server/.env.example server/.env
npm run dev
```

Open [http://localhost:2222](http://localhost:2222). Vite serves the UI on port **2222** and proxies `/api` to Express on **3001**.

| Script | What it does |
|--------|----------------|
| `npm run install:all` | Install root, server, and client dependencies |
| `npm run dev` | Run API + Vite together |
| `npm run dev:server` | API only (`localhost:3001`) |
| `npm run dev:client` | Vite only (`localhost:2222`) |
| `npm start` | Production-style server start (no nodemon) |

Before jobs can reach Colab you still need Google OAuth (developer once), a Hugging Face token, Google login, and a running notebook — see [First-time setup](#first-time-setup).

## Architecture

```
┌─────────────────┐     REST      ┌──────────────────┐
│  React (2222)   │ ───────────► │ Express (3001)   │
│  queue + gallery│              │ SQLite + Drive   │
└─────────────────┘              └────────┬─────────┘
                                          │ OAuth
                                          ▼
                                 ┌──────────────────┐
                                 │  Google Drive    │
                                 │  job_queue.json  │
                                 │  secrets.json    │
                                 │  results/…       │
                                 └────────┬─────────┘
                                          │ poll 30s
                                          ▼
                                 ┌──────────────────┐
                                 │ Colab notebook   │
                                 │ generate.py      │
                                 └──────────────────┘
```

## Drive folder structure

Created automatically under **My Drive** on first auth/sync:

```
My Drive/
├── visual_anagrams/
│   ├── job_queue.json          # shared job queue
│   ├── secrets.json            # HF token for Colab (synced by the app)
│   └── colab_heartbeat.json    # written by Colab every poll
├── visual_anagrams_results/
│   └── {job_id}/
│       └── image_1024.png      # result PNG (placeholder overwritten by Colab)
└── visual_anagrams_gallery/    # opt-in public shares (anyone-with-link)
    ├── gallery_manifest.json
    └── {job_id}.png
```

The app uses Google’s `drive.file` scope and pre-creates result placeholders. Colab must overwrite those same files by ID (not create new ones).

### Worker tiers

| Tier | Notebook | Runtime | Default output |
|------|----------|---------|----------------|
| **Pro** | `notebooks/batch_worker.ipynb` | Colab Pro, A100 + High-RAM | 1024×1024 (or 256×256) |
| **Free** | `notebooks/batch_worker_free.ipynb` | Free Colab T4 | 256×256 only |

Switch tier and resolution/steps in the app UI. Free-tier users paste their free notebook URL once so the banner opens the right Colab.

### Friend-link galleries

Completed images stay private until you **Publish** them. Publishing copies the PNG into `visual_anagrams_gallery/` (shared as anyone-with-link) and updates `gallery_manifest.json`.

1. Copy **your gallery link** from the Friends panel and send it to a friend
2. They paste that link under **Add friend** in their app
3. Use the **Friends** gallery tab to browse what they’ve published

Each install keeps its own friends list (keyed by Google account). No central server — browsing uses the public Drive manifest link.

### Job format

Jobs in Drive `job_queue.json` look like:

```json
{
  "id": "job_1a2b3c4d",
  "prompt_1": "FALL",
  "prompt_2": "snow",
  "status": "pending",
  "created_at": "2026-07-30T12:00:00Z",
  "updated_at": "2026-07-30T12:00:00Z",
  "completed_at": null,
  "error_message": null,
  "seed": 1234567890,
  "tier": "pro",
  "resolution": "1024",
  "num_inference_steps": 30,
  "generate_1024": true,
  "estimated_cu": 1.2,
  "result_folder_id": "…",
  "result_file_id": "…"
}
```

Statuses: `pending` → `processing` → `completed` | `failed`

## First-time setup

### 1. Developer (one-time): Google Cloud OAuth app

End users never create a Cloud project or paste Google API keys. You do this once for the app:

1. Create a Google Cloud project and enable the **Google Drive API**
2. Create an **OAuth Web client** with redirect URI  
   `http://localhost:2222/api/setup/auth/google/callback`
3. Use scope **`drive.file`** (app-created files only — not full Drive). The app
   pre-creates queue/result files; Colab overwrites them.
4. Put the client ID/secret in `server/.env` (or paste them in the setup UI):

```bash
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

You can also drop a downloaded client JSON at `credentials/credentials.json` / `credentials/oauth-client.json`.

### 2. End users

Open http://localhost:2222:

1. Paste your **Hugging Face** token (DeepFloyd IF license accepted)
2. Click **Login with Google** → authorize Drive access
3. The app stores *their* Drive token locally, syncs the HF token to Drive `secrets.json`, and sets up the Colab notebook

If you own the [shared template notebook](https://colab.research.google.com/drive/1fL4X4wJSHoFZBaWK77lb-EHW6Lb-c6Jd?usp=sharing), it’s used directly; other users get a Drive copy (or paste a free-tier notebook URL when using Free).

### 3. Start the Colab worker

1. Open **your** notebook from the app banner/setup screen
2. Set the runtime (Pro: A100 + High-RAM; Free: T4)
3. **Runtime → Run all** (HF token loads from Drive `secrets.json`)
4. Leave the final poll-loop cell running

The app banner shows **online** when `colab_heartbeat.json` is fresher than 2 minutes.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health + Drive/notebook hints |
| `POST` | `/api/jobs` | Add job `{ prompt_1, prompt_2 }` |
| `GET` | `/api/jobs` | List jobs (`?status=&q=`) |
| `GET` | `/api/jobs/:id` | Single job |
| `DELETE` | `/api/jobs/:id` | Delete job (and Drive queue entry) |
| `GET` | `/api/jobs/:id/image` | Cached result PNG |
| `POST` | `/api/jobs/:id/publish` | Publish image to public gallery |
| `DELETE` | `/api/jobs/:id/publish` | Unpublish from public gallery |
| `GET` | `/api/jobs/status` | Colab online + Drive status |
| `POST` | `/api/jobs/sync` | Force Drive sync |
| `GET` | `/api/setup/status` | Setup / OAuth / tier / notebook state |
| `GET` | `/api/friends/me` | Your gallery share link |
| `GET` | `/api/friends` | Friends list |
| `POST` | `/api/friends` | Add friend `{ galleryLink }` |
| `DELETE` | `/api/friends/:id` | Remove friend |
| `GET` | `/api/friends/gallery` | Collated friends’ published images |

## Project layout

```
├── client/                 # React + Vite (port 2222)
├── server/                 # Express + SQLite + Drive
│   └── .env.example        # copy to server/.env
├── notebooks/
│   ├── batch_worker.ipynb       # Pro Colab worker (A100, up to 1024×1024)
│   └── batch_worker_free.ipynb  # Free Colab worker (T4, 256×256)
├── credentials/            # OAuth client, tokens, HF secrets (gitignored)
├── data/                   # SQLite DB
└── cache/
    ├── images/             # Downloaded result PNGs
    └── friends/            # Cached friends’ published images
```

## Notes

- Generation command used by Colab (Pro / 1024 example):

  ```bash
  python generate.py --name {id} --prompts "{prompt_1}" "{prompt_2}" \
    --views identity rotate_180 --num_samples 1 \
    --num_inference_steps 30 --guidance_scale 10.0 --generate_1024
  ```

  Free tier / 256 omits `--generate_1024`. Step count and resolution follow the app’s generation settings.

- Local SQLite is the app’s source of truth for the UI; Drive `job_queue.json` is the handoff to Colab. The server syncs both ways every 15s.
- Without Google login, you can still queue jobs locally; they will not reach Colab until Drive is configured.
