# 24: Drop the paste-code box and fold the invite panel on connect

**What to build:** The handshake offered the invite a second time as a
paste-box code ("Falls der Link zu lang ist, hier der Code zum Einfügen:" plus
a readonly textarea). The link alone is enough, so remove the note and the
box. Also, the "Einladung teilen" panel should fold away on its own once the
two players are connected — it only did so for WebRTC.

**Blocked by:** 09 (Identity gate and handshake UI), 21 (Connection reliability)

**Status:** resolved

- [x] The "Falls der Link zu lang ist, hier der Code zum Einfügen:" note and its textarea are gone
- [x] The invite/reply flow works with the link only (copy button + reply box)
- [x] The "Einladung teilen" panel hides once a peer is connected over either transport
- [x] "Spiel verlassen" still leaves the reply box clean

## Comments

`play.html` drops the `#handshake-blob` note/textarea. `app.js` stops asking
the codec for a paste string (`encodePaste` leaves the import; `decodePaste`
stays so a pasted `HW2:`/legacy `HW1:` code still decodes). The reply
placeholder is now "Antwort-Link".

The panel already hid on WebRTC `connected`, but same-browser tabs talk over
`BroadcastChannel`, which never emits `connected` — the status only flips to
"Verbunden" when a `hello` registers the second peer. `receiveRemote` now calls
`hideHandshake()` in the `hello` and `hello-ack` branches, so the invite folds
away for both transports.

The hide is now an animated fold, not an instant vanish: `hideHandshake()` pins
the panel's real height in `--handshake-max`, flips on `.is-folded`, and only
takes it out of the layout once the `max-height` transition (260ms, disabled
under `prefers-reduced-motion`) has run. Re-opening during a fold expands it
again. `node --test` stays green (127 tests).
