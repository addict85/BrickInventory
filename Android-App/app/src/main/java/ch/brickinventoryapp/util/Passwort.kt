package ch.brickinventoryapp.util

/**
 * Die Mindestlaenge eines Passworts — an einer Stelle.
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
 * Die Zahl stand in dieser App ZWEIMAL, jedes Mal von Hand getippt:
 * SettingsScreen (Passwort aendern, dreimal in derselben Ansicht) und
 * LoginScreen (Registrieren). Im Server stand sie viermal, und an zwei der
 * sechs Stellen, die ein Passwort setzen, fehlte sie ganz — genau deshalb, weil
 * es keine Konstante gab: Wo eine Regel an jeder Stelle neu getippt wird, gibt
 * es keine Stelle, die man vergessen KOENNTE.
 *
 * ── Dass sie trotzdem dreimal existiert ─────────────────────────────────────
 * Server (utils/auth.ts), Webapp (public/js/01-core.js) und App teilen keinen
 * Code — drei Laufzeiten, drei Fassungen. Das ist unvermeidbar; das
 * Auseinanderlaufen ist es nicht. Web-App/test/passwortlaenge.test.js liest
 * alle drei Zahlen aus den Quellen und vergleicht sie.
 *
 * ── Und wofuer die Oberflaeche sie braucht ──────────────────────────────────
 * Der Server ist die Instanz, die die Regel DURCHSETZT. Die Oberflaeche sagt
 * sie dem Nutzer, bevor er auf Speichern drueckt — sonst kostet ein Tippfehler
 * eine Runde ueber das Netz.
 */
const PASSWORT_MIN_ZEICHEN = 8

/** Ist dieses Passwort zu kurz? */
fun passwortZuKurz(passwort: String): Boolean = passwort.length < PASSWORT_MIN_ZEICHEN
