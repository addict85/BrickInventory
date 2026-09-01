package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (loadSetDetail, updateQuantity, …)
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.util.resolveFullUrl
import coil.ImageLoader

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetDetailScreen(
    setNumber: String,
    vm: MainViewModel,
    serverUrl: String,
    // Wird tatsächlich benutzt — siehe unten.
    //
    // VORHER stand hier @Suppress("UNUSED_PARAMETER"): Der Parameter wurde
    // durchgereicht, aber nie verwendet, und statt ihn einzusetzen war die
    // Warnung stummgeschaltet. Die AsyncImage-Aufrufe fielen dadurch auf Coils
    // Standard-Loader zurück, der den Bearer-Token NICHT anhängt (den setzt nur
    // der Client aus di/AppModule.kt).
    //
    // Solange Set-Bilder ohne Anmeldung abrufbar waren, fiel das nicht auf.
    // Seit der Server für alle Bilder eine Anmeldung verlangt, antwortet er mit
    // 401 — und der Detail-Dialog blieb leer, ohne jede Fehlermeldung.
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onDelete: (String) -> Unit,
    onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit = { _, _, _, _ -> },
    onOpenPdf: (url: String, title: String) -> Unit = { _, _ -> }
) {
    val state       by vm.state.collectAsStateWithLifecycle()
    // Detail-Zustand aus eigenem Flow — Preis-/History-Loads rekomponieren
    // so nur noch diesen Screen, nicht alle AppUiState-Konsumenten.
    val detailState by vm.setDetailState.collectAsStateWithLifecycle()
    // Die Galerie-Liste dient hier nur als Rueckfall, solange das Detail noch
    // laedt — deshalb der eigene Fluss statt des ganzen App-Zustands.
    val galerie by vm.galleryState.collectAsStateWithLifecycle()
    val authToken = state.authToken
    val set       = detailState.setDetail?.takeIf { it.setNumber == setNumber }
                 ?: galerie.sets.find { it.setNumber == setNumber }
    val price     = detailState.setPrice?.takeIf { it.setNumber == setNumber }
    val history   = detailState.priceHistory
    val pnlPct    = history?.pnlPct
    val currency  = detailState.setPrice?.currency?.ifBlank { state.currency } ?: state.currency
    val coroutineScope = rememberCoroutineScope()
    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showSetDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    val acquisitions = detailState.acquisitions

    LaunchedEffect(setNumber) {
        vm.loadSetDetail(setNumber)
        vm.loadSetPrice(setNumber)
        vm.loadSetPriceHistory(setNumber)
        vm.loadAcquisitions(setNumber)
    }

    fun fmtPrice(v: Double?) = if (v == null) "—"
        else ch.brickinventoryapp.util.fmtMoney(v, currency)

    fun fmtDate(iso: String?) = if (iso == null) "—"
        else try { iso.take(10).split("-").let { "${it[2]}.${it[1]}.${it[0]}" } }
        catch (_: Exception) { iso }

    val isBrick = LocalIsBrickTheme.current
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        set?.name ?: setNumber,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.detail_back))
                    }
                },
                actions = {
                    // Kein Verschieben-Knopf: Verschoben wird über den
                    // KAUFPREIS, im Kaufpreis-Screen, Zeile für Zeile. Ein Set
                    // mit drei Erfassungen sind drei Käufe, die im Haushalt
                    // verschiedenen Kindern gehören können — „das Set
                    // verschieben" verdeckt, was tatsächlich wandert. Der
                    // Server erzwingt dieselbe Regel: move ohne
                    // acquisition_ids antwortet mit 400.
                    IconButton(onClick = { showSetDeleteConfirm = true }) {
                        Icon(Icons.Default.Delete, stringResource(R.string.detail_delete))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = if (isBrick) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.surface,
                    titleContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurfaceVariant,
                    actionIconContentColor = if (isBrick) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) { padding ->

        if (set == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        // Volle Auflösung — wie die Webapp: Dort zeigt der Detail-Dialog
        // (07-admin.js, "m-img") ebenfalls fullUrl(), keine Vorschau. Mein
        // früherer Kommentar hier behauptete das Gegenteil ("dieselbe
        // Unterscheidung wie in der Webapp") — das stimmte nicht; die Webapp
        // macht für ihr Haupt-Detailbild gar keine Thumb/Voll-Unterscheidung,
        // nur der Zoom war je nach Kontext unterschiedlich. Beide (Vorschau-
        // Karte und Zoom) benutzen jetzt dieselbe volle Auflösung.
        val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)
        // Einmaliger, verzögerter Wiederholversuch — wie in der Galerie-Kachel
        // (Nachtrag 49). Hier gab es bisher GAR KEINE Fehlerbehandlung: kein
        // onState, also weder zweiter Versuch noch Rückfall. Schlug der erste
        // Ladeversuch fehl — direkt nach dem Erfassen ist die Datei auf dem
        // Server oft noch nicht fertig —, blieb die Fläche leer, bis man den
        // Bildschirm verliess und neu öffnete. Coil versucht von sich aus nie
        // erneut.
        //
        // An setNumber UND imageUrl gebunden: Bei einem Wechsel des Sets oder
        // der Adresse beginnt die Zählung neu. setParameter macht die zweite
        // Anfrage für Coil unterscheidbar; ohne das gälte sie als dieselbe,
        // bereits gescheiterte.
        // Als State-Objekt statt per `by`: setDetailHeroImage() setzt den Wert
        // im Fehlerzweig, um Coil zu einem zweiten Anlauf zu bewegen — dafür
        // muss es dasselbe Objekt sein, keine Kopie (Nachtrag 98).
        val detailRetryState = remember(set.setNumber, imageUrl) { mutableIntStateOf(0) }
        val detailScope = rememberCoroutineScope()
        val zoomImageUrl = imageUrl

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {

            setDetailHeroImage(set, imageUrl, imageLoader, detailRetryState, detailScope) { showImageZoom = true }
            setDetailStatChips(set)
            setDetailValueTiles(set, price, isBrick, ::fmtPrice)
            setDetailDetailsSection(set, setNumber, vm, acquisitions, currency, ::fmtDate, onNavigateToAcqMgmt)
            setDetailPriceSection(set, detailState, price, history, pnlPct, currency, isBrick, ::fmtPrice)
            setDetailInstructionsSection(set, detailState, authToken, serverUrl, onOpenPdf)
        }

        if (showSetDeleteConfirm) {
            AlertDialog(
                onDismissRequest = { showSetDeleteConfirm = false },
                icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
                title = { Text(stringResource(R.string.gallery_delete_title)) },
                text = { Text(stringResource(R.string.gallery_delete_text, set.name ?: setNumber)) },
                confirmButton = {
                    TextButton(onClick = { showSetDeleteConfirm = false; onDelete(setNumber) }) {
                        Text(stringResource(R.string.gallery_delete), color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = { TextButton(onClick = { showSetDeleteConfirm = false }) { Text(stringResource(R.string.gallery_cancel)) } }
            )
        }

        if (showImageZoom && zoomImageUrl != null) {
            // Gemeinsame Umsetzung mit dem Katalog-Detail — siehe
            // ui/components/ZoomableImageDialog.kt. Vorher standen die Gesten-
            // und Zustandslogik nur hier; für den Katalog wäre sonst eine
            // zweite Kopie entstanden.
            ZoomableImageDialog(
                imageUrl = zoomImageUrl,
                contentDescription = set.name,
                imageLoader = imageLoader,
                onDismiss = { showImageZoom = false }
            )
        }
    }
}

