# Aus einem Testprotokoll ANNOTATIONEN machen — mit der Begruendung, nicht nur
# mit dem Namen.
#
# ── Woher diese Datei kommt ──────────────────────────────────────────────────
#
# Ein Lauf auf main war rot, genau ein Test. Abrufbar waren ueber die API nur
# Annotationen, und die lauteten:
#
#     [failure] Roter Test
#     Sitzung: gelesen wird immer, geschrieben nur alle paar Minuten (3178ms)
#
# Der Name, sonst nichts. DASS er rot war, stand fest; WARUM nicht. Die
# Begruendung lag im Joblog (der Schritt schreibt sie mit `grep -A 12` dorthin),
# aber das Joblog ist von hier aus nicht zu holen: GitHub liefert es ueber einen
# anderen Host, und der Proxy lehnt die Weiterleitung mit 403 ab. Dieselbe
# Begruendung steht schon im Workflow — nur eine Zeile zu hoch: Der Klartext
# ging ins Protokoll, die Annotation bekam ihn nicht.
#
# ── Was ausgelesen wird, GEMESSEN und nicht vermutet ─────────────────────────
#
# `npm test` laeuft in der CI ohne Terminal, Node 22 nimmt dann TAP. Nachgesehen
# an einem absichtlich roten Test:
#
#     not ok 1 - ein Test, der absichtlich rot ist
#       ---
#       duration_ms: 2.5
#       location: '…/fehl.test.js:3:1'
#       error: |-
#           zwei und zwei sind nicht fuenf
#           4 !== 5
#       code: 'ERR_ASSERTION'
#       expected: 5
#       actual: 4
#       operator: 'strictEqual'
#       stack: |-
#           …
#
# Alles zwischen der `not ok`-Zeile und `stack:` ist die Begruendung. Der
# Stapelabzug bleibt draussen: Er ist lang, und die Fundstelle steht schon in
# `location`.
#
# Beide Reporterformen, weil beide vorkommen: TAP schreibt `not ok …`, der
# spec-Reporter `✖ Name (12.3ms)` samt der Ueberschrift `✖ failing tests:` —
# die ist kein Testname und wird uebersprungen.
#
# ── Warum eine eigene Datei ──────────────────────────────────────────────────
#
# Damit sie pruefbar ist. Ein Diagnoseschritt, der nur im Ernstfall laeuft, ist
# der am wenigsten gepruefte Teil eines Workflows — und genau dann, wenn man ihn
# braucht, ist keine Zeit, ihn zu reparieren.
# test/ci-rote-tests.test.js fuettert sie mit echten Protokollen.

function esc(s) { gsub(/%/, "%25", s); gsub(/\r/, "%0D", s); return s }

function raus() {
  if (titel == "") return
  # Ueber dem Deckel wird nur noch gezaehlt. GitHub zeigt je Stufe und Schritt
  # hoechstens zehn Annotationen; die zehnte ist unten die Sammelmeldung.
  if (gezaehlt >= MAX) { unterdrueckt++; titel = ""; return }
  printf "::error title=Roter Test::%s\n", nachricht
  gezaehlt++
  titel = ""
}

BEGIN {
  MAX = 9
  # Eine einzelne Annotation wird von GitHub gekuerzt, wenn sie zu lang ist —
  # und zwar ohne Hinweis. Lieber selbst kuerzen und es dazusagen.
  ZEICHEN = 900
  gezaehlt = 0; unterdrueckt = 0; titel = ""; sammeln = 0
}

/^(not ok|✖ )/ {
  raus()
  z = $0
  sub(/^not ok [0-9]+ - /, "", z)   # TAP mit Nummer
  sub(/^not ok /, "", z)            # TAP ohne
  sub(/^✖ /, "", z)                 # spec
  if (z == "failing tests:") { titel = ""; sammeln = 0; next }
  titel = z; nachricht = esc(z); sammeln = 1
  next
}

{
  if (titel == "" || !sammeln) next
  if ($0 ~ /^[[:space:]]*stack:/) { sammeln = 0; next }
  if (length(nachricht) >= ZEICHEN) {
    nachricht = nachricht "%0A… (hier gekuerzt — vollstaendig in der Zusammenfassung des Schritts)"
    sammeln = 0
    next
  }
  nachricht = nachricht "%0A" esc($0)
}

END {
  raus()
  if (unterdrueckt > 0)
    printf "::error title=Weitere rote Tests::%d weitere rote Tests. GitHub zeigt je Stufe und Schritt hoechstens zehn Annotationen; die vollstaendige Liste steht in der Zusammenfassung dieses Schritts.\n", unterdrueckt
}
