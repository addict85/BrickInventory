package ch.brickinventoryapp.ui.screens

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  NICHT ÄNDERN OHNE ZU LESEN: Autofokus
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Der Scanner stellte in dieser Datei schon MEHRFACH nicht mehr scharf. Es
 *  waren jedes Mal dieselben zwei Fehler:
 *
 *  1. CONTROL_AF_MODE_CONTINUOUS_PICTURE muss an BEIDEN Use Cases stehen —
 *     am Preview UND an der ImageAnalysis. CameraX führt die Konfigurationen
 *     aller gebundenen Use Cases zu EINEM Repeating-Request zusammen; steht
 *     der Modus nur an einem, entscheidet je nach Gerät die andere
 *     Konfiguration mit, und das Bild bleibt unscharf. Der Code sieht dabei
 *     völlig richtig aus — das ist die Tücke.
 *
 *  2. KEIN periodisches startFocusAndMetering ("Fokus-Pump"). Ein im Takt
 *     laufender Aufruf zwingt die Kamera immer wieder in eine neue Messung,
 *     der Fokus wandert dauernd. Tap-to-Focus im Touch-Listener ist in
 *     Ordnung — eine Schleife, ein Timer oder ein delay() davor nicht.
 *
 *  Beides prüft CameraFocusConfigTest in app/src/test/. Schlägt der Test
 *  fehl, ist eine dieser Regeln verletzt — nicht den Test anpassen, sondern
 *  den Code.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import android.view.ViewGroup
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.*
import androidx.camera.view.PreviewView
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.viewinterop.AndroidView
import com.google.accompanist.permissions.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import android.view.MotionEvent
import androidx.compose.foundation.background
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun BarcodeScannerScreen(
    onResult: (String) -> Unit,
    /**
     * Texterkennung zusätzlich zum Barcode (Nachtrag 61, Marcos Vorgabe:
     * „nur bei Set hinzufügen und Teileliste hinzufügen").
     *
     * Standard AUS. Der Preisvergleich sucht mit dem gescannten Wert direkt
     * beim Händler — dort ist eine gelesene Zahl kein Gewinn, sondern ein
     * Risiko: Sie sieht aus wie ein Suchbegriff, ist aber nur wahrscheinlich
     * richtig. Ein Schalter mit Standard AUS heisst ausserdem, dass jeder
     * KÜNFTIGE Aufrufer die Texterkennung bewusst einschalten muss, statt sie
     * versehentlich zu erben.
     */
    ocrEnabled: Boolean = false,
    /** Per Texterkennung gelesene SETNUMMER — nur relevant, wenn ocrEnabled. */
    onSetNumberResult: (String) -> Unit = onResult,
    onDismiss: () -> Unit
) {
    val cameraPermission = rememberPermissionState(android.Manifest.permission.CAMERA)
    val defaultHint = stringResource(R.string.scanner_hint_default)
    val detectedHintFmt = stringResource(R.string.scanner_hint_detected)
    val confirmingHint = stringResource(R.string.scanner_hint_confirming)
    val aimHint = stringResource(R.string.scanner_hint_aim)
    val errorHint = stringResource(R.string.scanner_hint_error)
    var statusText by rememberSaveable { mutableStateOf(defaultHint) }
    var frozen    by rememberSaveable { mutableStateOf(false) }
    var torchOn   by rememberSaveable { mutableStateOf(false) }
    var cameraCtrl by remember { mutableStateOf<CameraControl?>(null) }

    LaunchedEffect(Unit) {
        if (!cameraPermission.status.isGranted) cameraPermission.launchPermissionRequest()
    }

    // Toggle torch when state changes
    LaunchedEffect(torchOn) { cameraCtrl?.enableTorch(torchOn) }

    // WICHTIG (bitte nicht wieder einen periodischen Fokus-Trigger einbauen!):
    // Der Autofokus läuft ausschliesslich über den CONTINUOUS_PICTURE-Modus der
    // Kamera (autofokusDauerhaft() in KameraAufbau.kt). Ein zusätzlicher, im
    // Takt laufender startFocusAndMetering-Aufruf ("Pump") zwingt die Kamera immer wieder in
    // einen Einzelfokus und lässt sie dadurch dauernd nachpumpen statt scharf zu
    // bleiben — das war die Ursache des wiederkehrenden Fokus-Problems. Manuelles
    // Fokussieren gibt es NUR noch beim Antippen (Tap-to-Focus, mit Auto-Cancel).

    val borderColor by animateColorAsState(
        if (frozen) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.primary,
        label = "border"
    )

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when {
            cameraPermission.status.isGranted -> {
                CameraPreviewBarcode(
                    frozen = frozen,
                    ocrEnabled = ocrEnabled,
                    onBarcodeFound = { value ->
                        if (!frozen) {
                            frozen = true
                            statusText = detectedHintFmt.replace("%1\$s", value)
                            onResult(value)
                        }
                    },
                    // Getrennter Rückweg (Nachtrag 60): Was hier ankommt, IST
                    // bereits die Setnummer. Sie darf nicht wie eine EAN durch
                    // die Rebrickable-Auflösung laufen — das kostete Kontingent
                    // und schlüge fehl, weil es zu einer Setnummer keinen
                    // Barcode-Eintrag gibt.
                    onSetNumberFound = { value ->
                        if (!frozen) {
                            frozen = true
                            statusText = detectedHintFmt.replace("%1\$s", value)
                            onSetNumberResult(value)
                        }
                    },
                    onStatus   = { if (!frozen) statusText = it },
                    confirmingHint = confirmingHint,
                    aimHint = aimHint,
                    errorHint = errorHint,
                    onCamera   = { cameraCtrl = it }
                )

                Column(
                    Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Spacer(Modifier.weight(0.2f))

                    // Scanning frame
                    Box(
                        Modifier
                            .fillMaxWidth(0.88f)
                            .aspectRatio(1.8f)
                            .border(2.dp, borderColor, Formen.knopf)
                    ) {
                        // Corner accents
                        val accent = borderColor
                        val cs = 20.dp
                        val ct = 3.dp
                        // Top-left
                        Box(Modifier.size(cs, ct).align(Alignment.TopStart).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.TopStart).background(accent))
                        // Top-right
                        Box(Modifier.size(cs, ct).align(Alignment.TopEnd).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.TopEnd).background(accent))
                        // Bottom-left
                        Box(Modifier.size(cs, ct).align(Alignment.BottomStart).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.BottomStart).background(accent))
                        // Bottom-right
                        Box(Modifier.size(cs, ct).align(Alignment.BottomEnd).background(accent))
                        Box(Modifier.size(ct, cs).align(Alignment.BottomEnd).background(accent))
                    }

                    Spacer(Modifier.height(16.dp))

                    Surface(color = Color.Black.copy(alpha = 0.72f), shape = Formen.kachel) {
                        Text(
                            statusText,
                            Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                            color = Color.White, fontSize = 13.sp,
                            textAlign = TextAlign.Center
                        )
                    }

                    Spacer(Modifier.height(16.dp))

                    // Torch button
                    FilledTonalButton(
                        onClick = { torchOn = !torchOn },
                        colors = ButtonDefaults.filledTonalButtonColors(
                            containerColor = if (torchOn) LocalStatusFarben.current.warnung else Color.White.copy(alpha = 0.15f),
                            contentColor   = if (torchOn) Color.Black else Color.White
                        )
                    ) {
                        Text(if (torchOn) stringResource(R.string.scanner_torch_off) else stringResource(R.string.scanner_torch_on), fontSize = 13.sp)
                    }

                    Spacer(Modifier.weight(0.8f))
                }
            }
            else -> {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.scanner_camera_needed), color = Color.White, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = { cameraPermission.launchPermissionRequest() }) { Text(stringResource(R.string.scanner_allow)) }
                    }
                }
            }
        }
        IconButton(onClick = onDismiss, modifier = Modifier.align(Alignment.TopEnd).padding(16.dp)) {
            Icon(Icons.Default.Close, stringResource(R.string.scanner_close), tint = Color.White)
        }
    }
}

/**
 * Kandidaten fuer eine Setnummer aus erkanntem Text — in absteigender Guete.
 *
 * Auf der ANLEITUNG steht kein Barcode; die Setnummer ist dort nur gedruckt.
 * Genau dafuer ist die Texterkennung da. Der Filter ist der eigentliche Kern:
 * Die Kamera sieht auf so einer Seite viele Zahlen (Altersangabe, Teilezahl,
 * Seitenzahl, Jahr). Ohne Einschraenkung kaeme staendig Unsinn heraus.
 *
 * ── Warum nicht mehr „die laengste gewinnt" (Marcos Meldung) ────────────────
 *
 * Hier stand `sortedByDescending { length }`, und der Test daneben schrieb die
 * Annahme hin: „Die Setnummer ist auf der Seite fast immer die laengste Zahl."
 *
 * Auf einer Anleitung stimmt das nicht. Dort stehen sechs- und siebenstellige
 * Zahlen, die KEINE Setnummern sind — die Bestellnummer des Hefts auf dem
 * Umschlag, die Elementnummern in der Teileliste. Die Setnummer selbst hat
 * vier oder fuenf Stellen.
 *
 * ── Warum dreistellige Zahlen jetzt zaehlen ─────────────────────────────────
 *
 * NACHGEMESSEN an zehn Kartonaufdrucken: acht richtig an erster Stelle, und
 * beide Fehlschlaege waren alte Sets mit dreistelliger Nummer —
 *
 *     „375 YELLOW CASTLE 1978"  → ['1978']   (das JAHR gewann)
 *     „928 GALAXY EXPLORER"     → []         (gar kein Kandidat)
 *
 * `\d{4,7}` sah die 375 und die 928 nie. Wer ein altes Set vor die Kamera
 * haelt, bekam entweder nichts oder die Jahreszahl angeboten.
 *
 * Dreistellige Zahlen sind dafuer haeufiger Rauschen. Deshalb stehen sie in
 * der Guete GANZ HINTEN: Solange irgendeine vier- bis siebenstellige Zahl
 * uebrig ist, aendert sich an der Antwort nichts. Das ist hier wichtiger als
 * auf dem Server, denn BarcodeAnalyzer.kt nimmt `firstOrNull()` OHNE
 * Katalogabgleich — die Reihenfolge entscheidet direkt, was der Nutzer sieht.
 *
 * ── Die Reihenfolge, und warum ──────────────────────────────────────────────
 *
 *  1. Eine Zahl, auf die ein MENGENWORT folgt, ist eine Teilezahl und faellt
 *     ganz weg („1215 Teile").
 *  2. Mit Variantensuffix (`60445-1`) zuerst. So schreibt sich eine Setnummer
 *     und sonst nichts auf der Seite — das ist die einzige EINDEUTIGE Form.
 *  3. Eine Zahl direkt hinter `#` ist bevorzugt.
 *  4. Eine vierstellige Zahl zwischen 1949 und dem naechsten Jahr ist
 *     wahrscheinlich ein Jahr und wird ZURUECKGESTUFT — nicht verworfen.
 *     Vierstellige Setnummern in diesem Bereich gibt es wirklich.
 *  5. Danach nach Stellenzahl in der Reihenfolge 5, 4, 6, 7, 3. Das ist die
 *     Haeufigkeit echter Setnummern, nicht ihre Groesse.
 *  6. Bei Gleichstand die Reihenfolge im Text.
 *
 * Geraten bleibt es trotzdem — deshalb markiert die App jeden so gelesenen
 * Treffer als unsicher (BarcodeUiState.unsicher), und der Dialog sagt es.
 *
 * ── Dieselbe Frage steht in TypeScript ──────────────────────────────────────
 * Web-App/utils/produkttitel.ts beantwortet sie fuer Haendlertitel. Diese
 * Fassung laeuft offline in der Kameraschleife und kann sie nicht aufrufen —
 * damit die beiden nicht auseinanderlaufen, pruefen BEIDE Seiten denselben
 * Korpus: shared/setnummer-korpus.json (siehe SetnummerKorpusTest).
 */

/**
 * Woerter, die eine Zahl als Mengenangabe ausweisen.
 *
 * Wortgleich mit MENGENWORT in Web-App/utils/produkttitel.ts. `(?iu)` statt
 * RegexOption.IGNORE_CASE: Javas Ignorieren der Gross-/Kleinschreibung ist
 * ohne `u` auf ASCII beschraenkt, „STUECKE" mit Umlaut faellt sonst durch.
 */
private val MENGENWORT = Regex(
    "(?iu)^\\s*(?:x\\s*)?(?:pcs?|pieces?|piece|teil(?:e|en)?|stück(?:e|en)?|" +
    "stueck(?:e|en)?|stein(?:e|en)?|bricks?|parts?|element(?:e|en|s)?)\\b"
)

/**
 * Stellenzahlen in absteigender Guete. Unbekannte Laengen landen dahinter.
 * Muss mit `GUETE` in Web-App/utils/produkttitel.ts uebereinstimmen.
 */
internal val GUETE = listOf(5, 4, 6, 7, 3)

/**
 * Drei bis sieben Ziffern, optional mit `#` davor und Variantenzusatz dahinter.
 *
 * Steht hier oben und nicht in der Funktion: Sie laeuft in der Kameraschleife
 * (alle 700 ms, siehe BarcodeAnalyzer.kt), und ein Regex wird sonst bei jedem
 * Bild neu uebersetzt. Wortgleich mit `muster` in produkttitel.ts.
 */
private val SETNUMMER_MUSTER = Regex("(#\\s*)?\\b(\\d{3,7})(-\\d{1,2})?\\b")

private data class SetnummerKandidat(
    val wert: String,
    val mitSuffix: Boolean,
    val mitRaute: Boolean,
    val jahr: Boolean,
    val guete: Int,
)

internal fun setNumberCandidates(text: String): List<String> {
    val jahrGrenze = java.time.Year.now().value + 1
    val gefunden = ArrayList<SetnummerKandidat>()
    for (treffer in SETNUMMER_MUSTER.findAll(text)) {
        val ziffern = treffer.groupValues[2]
        val suffix = treffer.groupValues[3]
        // Regel 1: Was ein Mengenwort hinter sich hat, ist eine Teilezahl.
        val danach = text.substring(treffer.range.last + 1)
        if (MENGENWORT.containsMatchIn(danach)) continue
        val zahl = ziffern.toIntOrNull() ?: continue
        // Mit Variantenzusatz ist es keine Jahreszahl mehr, sondern eine
        // Setnummer in ihrer eindeutigen Schreibweise.
        val jahr = suffix.isEmpty() && ziffern.length == 4 && zahl >= 1949 && zahl <= jahrGrenze
        // Unbekannte Laenge ganz nach hinten statt an den Anfang: indexOf
        // liefert sonst -1 und die Zahl gewaenne alles.
        val guete = GUETE.indexOf(ziffern.length).let { if (it < 0) GUETE.size else it }
        gefunden.add(SetnummerKandidat(ziffern + suffix, suffix.isNotEmpty(),
            treffer.groupValues[1].isNotEmpty(), jahr, guete))
    }
    // sortedWith ist stabil, also bleibt bei Gleichstand die Reihenfolge im Text.
    return gefunden.distinctBy { it.wert }
        .sortedWith(
            compareByDescending<SetnummerKandidat> { it.mitSuffix }
                .thenByDescending { it.mitRaute }
                .thenBy { it.jahr }
                .thenBy { it.guete }
        )
        .map { it.wert }
}

@androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
@Composable
fun CameraPreviewBarcode(
    frozen: Boolean,
    ocrEnabled: Boolean,
    onBarcodeFound: (String) -> Unit,
    /** Per Texterkennung gelesene SETNUMMER — braucht KEINE EAN-Auflösung. */
    onSetNumberFound: (String) -> Unit,
    onStatus: (String) -> Unit,
    onCamera: (CameraControl) -> Unit,
    confirmingHint: String,
    aimHint: String,
    errorHint: String
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    // Der Tipp-zum-Scharfstellen-Listener wird im factory-Block gesetzt, die
    // Kamerasteuerung existiert aber erst nach dem Binden — deshalb über eine
    // Referenz, die beim Binden gefüllt wird. Sie gehört zur VORSCHAU und nicht
    // zur Analyse; beim Herauslösen war sie zuerst mitgewandert (Nachtrag 99).
    val _kameraCtrl = remember { java.util.concurrent.atomic.AtomicReference<CameraControl?>(null) }

    // Die Analyse-Schleife (Barcode, Texterkennung, Bestätigungszählung,
    // Drosselung, Aufräumen) steht seit Nachtrag 99 in BarcodeAnalyzer.kt.
    val imageAnalyzer = rememberBarcodeAnalyzer(
        frozen, ocrEnabled, onBarcodeFound, onSetNumberFound, onStatus,
        confirmingHint, aimHint, errorHint,
    )

    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                scaleType = PreviewView.ScaleType.FILL_CENTER
                implementationMode = PreviewView.ImplementationMode.PERFORMANCE
            }

            // Tippen zum Scharfstellen (Nachtrag 71).
            //
            // Der kontinuierliche Autofokus entscheidet selbst, worauf er
            // scharfstellt — bei einer Anleitung dicht vor der Linse liegt er
            // gern daneben und braucht lange, bis er umschwenkt. Ein Tipper auf
            // die Stelle gibt der Kamera einen ausdrücklichen Messpunkt und
            // löst sofort aus, statt zu warten.
            //
            // Bewusst mit disableAutoCancel(): Ohne das fällt die Kamera nach
            // fünf Sekunden auf ihre eigene Wahl zurück — der Nutzer hätte
            // gezielt scharfgestellt und es wäre kurz darauf wieder weg.
            previewView.setOnTouchListener { v, ev ->
                if (ev.action == android.view.MotionEvent.ACTION_UP) {
                    val punkt = previewView.meteringPointFactory.createPoint(ev.x, ev.y)
                    try {
                        val aktion = androidx.camera.core.FocusMeteringAction.Builder(
                            punkt, androidx.camera.core.FocusMeteringAction.FLAG_AF
                        ).disableAutoCancel().build()
                        _kameraCtrl.get()?.startFocusAndMetering(aktion)
                    } catch (_: Exception) { /* Kamera noch nicht bereit */ }
                    v.performClick()
                }
                true
            }

            // Anbieter holen, Vorschau bauen, binden: KameraAufbau.kt. Hier
            // bleibt nur, was den Scanner betrifft.
            kameraBinden(
                ctx = ctx,
                previewView = previewView,
                lifecycleOwner = lifecycleOwner,
                analyse = imageAnalyzer,
                beiFehler = {
                    // Kamera nicht verfügbar (belegt, Hardware-Fehler): Hinweis
                    // zeigen statt schwarzem Bild ohne Erklärung.
                    onStatus(errorHint)
                },
            ) { camera ->
                onCamera(camera.cameraControl)
                // Auch für das Tippen zum Scharfstellen bereitstellen
                // (Nachtrag 71) — ohne diese Zeile bliebe der Listener wirkungslos.
                //
                // Hier stand ein ZWEITER Tap-to-Focus (Nachtrag 112). Marcos
                // Befund: „Die Kamera im Barcodescanner stellt wieder nicht
                // scharf." `setOnTouchListener` FÜGT NICHT HINZU, es ersetzt —
                // der Listener oben in der factory wurde von diesem hier
                // stillschweigend überschrieben. Der Listener oben braucht nur
                // die Kamerasteuerung, und die bekommt er über _kameraCtrl.
                _kameraCtrl.set(camera.cameraControl)
            }
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
