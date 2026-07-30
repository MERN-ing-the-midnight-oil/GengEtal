# Visual Anagrams Batch Generator

Local web app that queues visual-anagram jobs and processes them in batches via a Google Colab notebook. The app and Colab worker sync through Google Drive.

**App URL:** [http://localhost:2222](http://localhost:2222)

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
│   └── colab_heartbeat.json    # written by Colab every poll
└── visual_anagrams_results/
    └── {job_id}/
        └── image_1024.png      # completed 1024×1024 image
```

### Job format

```json
{
  "id": "job_1a2b3c4d",
  "prompt_1": "FALL",
  "prompt_2": "snow",
  "status": "pending",
  "created_at": "2026-07-30T12:00:00Z",
  "updated_at": "2026-07-30T12:00:00Z",
  "completed_at": null,
  "error_message": null
}
```

Statuses: `pending` → `processing` → `completed` | `failed`

## Setup

### 1. Install

```bash
npm run install:all
```

### 2. Run the app

```bash
npm run dev
```

### Developer (one-time): Google Cloud OAuth app

End users never create a Cloud project or paste API keys. You do this once for the app:

1. Create a Google Cloud project and enable the **Google Drive API**
2. Create an **OAuth Web client** with redirect URI  
   `http://localhost:2222/api/setup/auth/google/callback`
3. Use scope **`drive.file`** (app-created files only — not full Drive). The app
   pre-creates queue/result files; Colab overwrites them.
4. Put the client ID/secret in `server/.env` (or the setup UI):

```bash
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

### End users

Open http://localhost:2222:

1. Paste your **Hugging Face** token (DeepFloyd IF license accepted)
2. Click **Login with Google** → authorize Drive access
3. The app stores *their* Drive token locally, syncs the HF token to Drive, and sets up the Colab notebook

If you own the [shared template notebook](https://colab.research.google.com/drive/1fL4X4wJSHoFZBaWK77lb-EHW6Lb-c6Jd?usp=sharing), it’s used directly; other users get a Drive copy.

### 6. Start the Colab worker

1. Open **your** notebook from the app banner/setup screen (A100 + High-RAM)
2. **Runtime → Run all** (HF token loads from Drive)
3. Leave the final poll-loop cell running

The app banner shows **online** when `colab_heartbeat.json` is fresher than 2 minutes.

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/jobs` | Add job `{ prompt_1, prompt_2 }` |
| `GET` | `/api/jobs` | List jobs (`?status=&q=`) |
| `GET` | `/api/jobs/:id` | Single job |
| `GET` | `/api/jobs/:id/image` | Cached result PNG |
| `GET` | `/api/jobs/status` | Colab online + Drive status |
| `POST` | `/api/jobs/sync` | Force Drive sync |

## Project layout

```
├── client/                 # React + Vite (port 2222)
├── server/                 # Express + SQLite + Drive
├── notebooks/
│   └── batch_worker.ipynb  # Colab poll/generate loop
├── credentials/            # credentials.json + token.json (gitignored)
├── data/                   # SQLite DB
└── cache/images/           # Downloaded result PNGs
```

## Notes

- Generation command used by Colab:

  ```bash
  python generate.py --name {id} --prompts "{prompt_1}" "{prompt_2}" \
    --views identity rotate_180 --num_samples 1 \
    --num_inference_steps 30 --guidance_scale 10.0 --generate_1024
  ```

- Local SQLite is the app’s source of truth for the UI; Drive `job_queue.json` is the handoff to Colab. The server syncs both ways every 15s.
- Without credentials, you can still queue jobs locally; they will not reach Colab until Drive is configured.
