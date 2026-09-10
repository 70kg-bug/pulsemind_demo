# PulseMind replay — prototype 2

The judges' copy of the demo. It runs **no model**: every score, band and explanation was produced
by the on-site stack (XGBoost on CUDA, local 7B) and recorded by `record.py`; `server.py` answers
the same `/api` routes from that recording, one ward per browser session. The UI says so on every
screen. Python 3.8+ standard library only.

```sh
./run.sh 8750                 # 127.0.0.1:8750; HOST=0.0.0.0 ./run.sh 8750 to expose directly
./tunnel.sh 8750              # or: https via a Cloudflare quick tunnel; prints the URL
./stop.sh                     # stops both; sessions survive in sessions.json
curl -s 127.0.0.1:8750/healthz
```

Each browser gets its own 48-hour ward: *Stream* advances it an hour per step, *Restart ward*
rewinds it, *Generate explanation* returns the recorded text after the time it took on-site.
Reloading keeps your ward. Logs are in `replay.log` and `tunnel.log`.

Building the tarball, on the demo laptop (needs the live stack only for `record.py`):

```sh
python replay/record.py reads          # seed + 48 ticks, every read the UI makes
python replay/record.py explanations   # the 7B, every bed x hour (resumable)
python replay/record.py verify         # the recording reproduces, byte for byte
python replay/check_replay.py          # the replay equals the recording, per session
python replay/package.py               # -> replay/dist/pulsemind-replay-*.tar.gz
```
