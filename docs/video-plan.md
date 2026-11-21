# Short gift videos: a possible plan (not scheduled)

Status (2026-11-21): **low priority, parked.** Jim's call: build it only if Hosts or guests ask for it. The worry is the extra load on the server (CPU to convert, traffic to play).

## The idea

A guest records a short video of their gift ("here's why you want my gift") and posts it to the Feed, the way they post a Photo today.

## What the code does today

Posts carry Photos only. A video is turned away in three places:

- **The phone's picker** offers images only (`accept="image/*"` in `packages/web/src/Feed.tsx`).
- **The server** sends every upload through sharp and re-saves it as a JPEG (`preparePhoto` in `packages/server/src/photos.ts`). Sharp can't read a video, so the Post is refused.
- **The size cap**: `PHOTO_MAX_BYTES` is 12 MB, and ww-edge's `request_body` allows 20 MB.

## Sizes

| | 10 s | 20 s | 30 s |
|---|---|---|---|
| Straight off a phone at 1080p (4K is 3–4× more) | 10–20 MB | 20–40 MB | 30–60 MB |
| Converted to 720p H.264 MP4 (~1.5 Mbps) | ~2 MB | ~4 MB | ~6 MB |

## Proposed shape

- **Length:** at most 15–20 seconds, checked on the phone before sending and on the server after converting.
- **Upload cap:** about 60 MB for a video, as its own limit (Photos keep 12 MB). ww-edge's `request_body` has to be raised to match.
- **Convert on the server.** iPhones record HEVC in MOV, which many Android phones and browsers can't play. ffmpeg converts each upload to a 720p H.264 MP4 (**open:** keep the sound, or drop the audio track?). It also takes a still frame for the Feed.
  - **One at a time, in a queue,** at low priority (`nice`), so conversions can't starve live Games. A 15-second clip should take a few seconds of CPU on 2 vCPU.
  - The Post shows "Getting your video ready…" until the conversion finishes.
- **Play on tap.** The Feed and the scoreboard show the still frame, and the video loads only when someone taps it. It never autoplays: 100 phones each loading 20 videos would move about 8 GB in one party.
- **Keeping:** the same 60-day cleanup as Photos (`PHOTO_KEEP_DAYS`), in the same per-Game folder, and in `backup.sh`.
- **Host switch:** a Game setting to allow videos, off by default for now. (**Open:** off or on by default? See the opt-in safeguards rule.)
- **Hiding and moderation:** same as a Photo (Hide, Mute).

## Costs

- **Disk:** about 4 MB a video. 100 Games × 20 videos ≈ 8 GB.
- **Traffic:** this is the real cost. Play on tap keeps it to the videos people actually watch. Cloudflare can cache public videos the way it caches public Photos.
- **CPU:** the conversion queue. The load test should include a few uploads at once.

## Work

A few days, plus real-device tests: iPhone (HEVC), Android, the big screen. Pieces: an ffmpeg image layer in the Dockerfile; the upload route and queue; storage and cleanup; the Feed's still frame and player; the Host setting; tests.

## Open questions

- Keep the sound, or mute it?
- 15 or 20 seconds?
- Can a video be a Gift's pitch, like a Photo?
- Should videos show on the scoreboard, or only on phones?
