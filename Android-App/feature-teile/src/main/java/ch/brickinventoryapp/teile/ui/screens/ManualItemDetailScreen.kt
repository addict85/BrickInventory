package ch.brickinventoryapp.teile.ui.screens

import androidx.compose.runtime.remember
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.zustand.ui.ManualItemDetailUiState
import ch.brickinventoryapp.teile.ui.TeileUiState
import ch.brickinventoryapp.teile.ui.FigurenUiState
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.teile.ui.viewmodel.TeileAktionen
import ch.brickinventoryapp.teile.ui.viewmodel.FigurenAktionen
import ch.brickinventoryapp.teile.ui.viewmodel.FigurenViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeAktionen
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import ch.brickinventoryapp.ui.components.Rueckfrage
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import coil3.ImageLoader
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.MengenKnopf
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.farbUebersetzer
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.model.fach.OHNE_FARBE
import ch.brickinventoryapp.ui.theme.LocalAkzentflaechen
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.gemeinsam.ui.AcquisitionSummarySection
import ch.brickinventoryapp.gemeinsam.ui.KennzahlenReihe
import ch.brickinventoryapp.gemeinsam.ui.LagerortFeld
import ch.brickinventoryapp.gemeinsam.ui.MarketPriceByCondition
import ch.brickinventoryapp.gemeinsam.ui.PreisLaedtZeile
import ch.brickinventoryapp.gemeinsam.ui.PriceChart
import ch.brickinventoryapp.gemeinsam.ui.SectionCard
import ch.brickinventoryapp.gemeinsam.ui.StatChipV2
import ch.brickinventoryapp.gemeinsam.ui.WertKacheln

/**
 * Detailansicht eines manuell erfassten Teils / einer Minifigur — als ganzer Screen wie bei
 * den Sets, weil der Inhalt (Bild, Mengenwahl, Kaufpreise und Marktpreise je Zustand,
 * Preisverlauf, Löschen) für einen AlertDialog zu lang ist.
 */
@Composable
fun ManualItemDetailRoute(
    vm: KaeufeViewModel,
    teile: TeileViewModel,
    figuren: FigurenViewModel,
    type: Postenart,
    id: String,
    colorId: Int = OHNE_FARBE,
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit,
    onFarbeGeaendert: (neueFarbe: Int) -> Unit = {},
    /** Bietet die Liste dahinter „Rückgängig“ an? Dann merkt Löschen nur vor. */
    rueckgaengig: Boolean = false,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    // Nur die Liste des Eintrags beobachten: Sie lädt beim Beobachten, die andere bliebe ungenutzt.
    val teileZustand = if (type == Postenart.FIG) TeileUiState() else teile.teileState.collectAsStateWithLifecycle().value
    val figurenZustand = if (type == Postenart.FIG) figuren.figurenZustand.collectAsStateWithLifecycle().value else FigurenUiState()
    val manDetailState by remember(type, id, colorId) { vm.kaeufeVon(type, id, colorId) }.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    ManualItemDetailScreen(
        zustand = EinzelstueckZustand(state, teileZustand, figurenZustand, manDetailState, lagerZustand, rueckgaengig),
        kaeufe = vm, teile = teile, figuren = figuren, type = type, id = id, colorId = colorId,
        fallbackTitle = fallbackTitle, imageLoader = imageLoader, onBack = onBack,
        onNavigateToAcqMgmt = onNavigateToAcqMgmt, onFarbeGeaendert = onFarbeGeaendert,
    )
}

/** Was die Detailansicht eines manuellen Eintrags zeigt. */
internal data class EinzelstueckZustand(
    val state: AppUiState,
    val teile: TeileUiState,
    val figuren: FigurenUiState,
    val manDetailState: ManualItemDetailUiState,
    val lagerZustand: LagerUiState,
    /** Bietet die Liste dahinter „Rückgängig“ an? Dann merkt Löschen nur vor. */
    val rueckgaengig: Boolean = false,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ManualItemDetailScreen(
    zustand: EinzelstueckZustand,
    kaeufe: KaeufeAktionen,
    /** Die Zeile des Eintrags und das Ändern, Löschen, Umfärben. */
    teile: TeileAktionen,
    figuren: FigurenAktionen,
    type: Postenart,
    id: String,            // partNumber / figNumber
    colorId: Int = OHNE_FARBE,
    /** Aus der Navigation — bis die Bewertung geladen ist, steht er in der Leiste. */
    fallbackTitle: String,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit,
    /**
     * Die Farbe wurde geändert — der Screen muss mit der neuen Farbe neu geöffnet
     * werden: Sie ist Teil der Kennung (Route
     * manual_detail/{type}/{id}/{colorId}/{title}) und der Suche unten (`it.colorId ==
     * colorId`); sonst stünde er leer da, obwohl die Änderung geklappt hat. Vorgabe
     * leer, weil eine Figur keine Farbe hat.
     */
    onFarbeGeaendert: (neueFarbe: Int) -> Unit = {},
) {
    val rueckgaengig = zustand.rueckgaengig
    val state = zustand.state
    val teileZustand = zustand.teile
    val figurenZustand = zustand.figuren
    val manDetailState = zustand.manDetailState
    val lagerZustand = zustand.lagerZustand

    val isFig = type == Postenart.FIG
    val currency = state.currency

    // Name und Bild kommen aus derselben Liste wie im Reiter (/parts/manual bzw.
    // /minifigs/manual); sie, die Farbauswahl und die Käufe laden die ViewModels beim
    // Beobachten, auch nach einem Tiefenlink oder Prozessneustart.

    val fig  = if (isFig) figurenZustand.manualFigs?.find { it.figNumber == id } else null
    val part = if (!isFig) teileZustand.manualParts?.find {
        it.partNumber == id && it.colorId == colorId
    } else null

    val title = fig?.figName ?: part?.partName ?: fallbackTitle.ifBlank { id }
    val quantity = fig?.quantity ?: part?.quantity ?: 1
    val imageUrl = resolveFullUrlViaProxy(
        state.serverUrl, fig?.imageLocal ?: part?.imageLocal, fig?.imageUrl ?: part?.imageUrl)

    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }

    val akzent = LocalAkzentflaechen.current
    Scaffold(
        topBar = {
            // Derselbe Kopf wie jedes Detail (DetailTopAppBar).
            DetailTopAppBar(
                titel = title,
                onZurueck = onBack,
                farben = TopAppBarDefaults.topAppBarColors(
                    containerColor = akzent.detailLeiste,
                    titleContentColor = akzent.aufDetailLeiste,
                    navigationIconContentColor = akzent.aufDetailLeiste,
                    actionIconContentColor = akzent.aufDetailLeiste,
                ),
                actions = {
                    MitTooltip(stringResource(R.string.common_delete)) {
                        IconButton(onClick = { showDeleteConfirm = true }) {
                            Icon(Icons.Default.Delete, stringResource(R.string.common_delete))
                        }
                    }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
    ) { padding ->

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = Abstaende.sehrGross),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            // ── Kopf: Bild und Kennzahlen, derselbe wie beim Teil aus einem Set ──
            item {
                val labelNumber = stringResource(
                    if (isFig) R.string.detail_fig_number else R.string.detail_part_number)
                val labelColor  = stringResource(R.string.detail_color)
                val farbe = farbUebersetzer()
                val chips = buildList {
                    add(labelNumber to id)
                    part?.colorName?.let { add(labelColor to farbe(it)) }
                    fig?.blFigNumber?.let { add("BrickLink" to it) }
                }
                TeilDetailKopf(imageUrl, imageLoader, title, chips, onZoom = { showImageZoom = true },
                    Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel))
            }

            // ── Wert-Kacheln wie im Set-Detail, in jedem Design ───────────────
            item {
                // Dieselben Wörter wie im Set-Detail: ein Gerüst, ein Text für „kein Preis“.
                WertKacheln(
                    markt = (fig?.avgPrice ?: part?.avgPrice)?.let { fmtMoney(it, currency) }
                        ?: stringResource(R.string.detail_price_none_yet),
                    kauf = (fig?.purchasePrice ?: part?.purchasePrice)?.let { fmtMoney(it, currency) }
                        ?: stringResource(R.string.detail_purchase_none),
                    pnl = fig?.pnlProzent ?: part?.pnlProzent,
                    modifier = Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel),
                )
            }

            // ── Details: Menge und Kaufpreise ──────────────────────────────────
            item {
                SectionCard(title = stringResource(R.string.detail_section_item)) {
                    // Menge folgt der Summe der Erfassungen, sobald es welche
                    // gibt — nach dem Löschen einer Erfassung stimmt der Zähler
                    // damit ohne eigenes Nachhalten.
                    val acqTotal = if (manDetailState.acquisitions.isNotEmpty())
                        manDetailState.acquisitions.sumOf { it.quantity } else quantity
                    var qty by remember(acqTotal) { mutableIntStateOf(acqTotal) }

                    MengenZeile(
                        menge = qty,
                        onWeniger = {
                            if (qty > 1) {
                                qty--
                                // owner: Besitzer der KARTE. Im Haushalt zeigt
                                // der manuelle Bereich die Eintraege aller
                                // Konten; ohne die Angabe schreibt der Server
                                // in die Zeile des Aufrufers.
                                if (isFig) figuren.updateMinifig(id, qty, fig?.unitPrice?.alsDouble(), fig?.blFigNumber, owner = fig?.userId)
                                else teile.updatePart(id, colorId, qty, part?.unitPrice?.alsDouble(), part?.condition, owner = part?.userId)
                            }
                        },
                        onMehr = {
                            qty++
                            if (isFig) figuren.updateMinifig(id, qty, fig?.unitPrice?.alsDouble(), fig?.blFigNumber, owner = fig?.userId)
                            else teile.updatePart(id, colorId, qty, part?.unitPrice?.alsDouble(), part?.condition, owner = part?.userId)
                        },
                    )

                    // ── Farbe (nur Teile) — änderbar ──
                    //
                    // Für den Fall, dass die Farbe falsch geladen wurde. Das Feld steht immer da,
                    // auch ohne Farbnamen — gerade dieses Teil ist das, das korrigiert werden muss.
                    if (!isFig) {
                        HorizontalDivider(Modifier.padding(vertical = Abstaende.winzig),
                            color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.detail_color),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            FarbWahlFeld(
                                farben = teileZustand.partsColors,
                                aktuell = colorId,
                                aktuellerName = part?.colorName,
                                aktuellerHex = part?.colorHex,
                                onWahl = { c ->
                                    teile.setzeTeilFarbe(id, colorId, c.id, c.name, c.hex,
                                        owner = part?.userId, onFertig = onFarbeGeaendert)
                                },
                                modifier = Modifier.padding(start = Abstaende.gross)
                                    .widthIn(max = 180.dp),
                            )
                        }
                    }

                    HorizontalDivider(Modifier.padding(vertical = Abstaende.winzig),
                        color = MaterialTheme.colorScheme.outlineVariant)

                    // ── Lagerort ──
                    //
                    // Dasselbe Bedienelement und derselbe entprellte Weg wie im Set-Detail und im
                    // Dialog der Teile aus Sets; nur die Adresse hängt am Typ, weil eine Figur
                    // keine Farbe hat.
                    Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.detail_storage),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        LagerortFeld(
                            wert = (if (isFig) fig?.storage else part?.storage) ?: "",
                            // Der VORRAT, nicht die belegten Orte: Auch ein
                            // leeres Regal soll zur Wahl stehen.
                            vorrat = lagerZustand.eigene.map { it.name },
                            onWert = { kaeufe.setzeManuellenLagerort(type, id, colorId, it) },
                            modifier = Modifier.padding(start = Abstaende.gross)
                                .weight(1f).widthIn(max = 320.dp),
                        )
                    }

                    HorizontalDivider(Modifier.padding(vertical = Abstaende.winzig),
                        color = MaterialTheme.colorScheme.outlineVariant)

                    // Dieselbe Zusammenfassung wie im Set-Detail — eine Zeile je
                    // Kaufpreis, Bearbeiten führt auf den Kaufpreis-Screen.
                    AcquisitionSummarySection(
                        acquisitions = manDetailState.acquisitions,
                        currency = currency,
                        onEditPrices = { onNavigateToAcqMgmt(type, id, colorId, title) }
                    )
                }
            }

            // ── Marktpreis je Zustand und Verlauf ──
            //
            // Der Ladezustand gehört in die Bedingung: Sonst erschiene der Abschnitt erst mit
            // der Antwort, und bis dahin wäre „lädt noch“ nicht von „keine Marktpreise“ zu
            // unterscheiden — wie preisAbruf in SetDetailSections.kt.
            val history = manDetailState.priceHistory
            val byCond  = history?.byCondition
            val chart   = history?.chart
            val laedt   = manDetailState.verlaufAbruf.laedt
            if (byCond?.present()?.isNotEmpty() == true || chart?.values?.isNotEmpty() == true || laedt) {
                item {
                    SectionCard(title = stringResource(R.string.detail_section_market)) {
                        if (laedt && history == null) {
                            PreisLaedtZeile()
                        }
                        byCond?.takeIf { it.present().isNotEmpty() }?.let {
                            MarketPriceByCondition(it, currency)
                        }
                        chart?.takeIf { it.values.isNotEmpty() }?.let {
                            Spacer(Modifier.height(Abstaende.klein))
                            PriceChart(it, currency)
                        }
                    }
                }
            }
        }

        if (showDeleteConfirm) {
            LoeschenFrage(
                isFig = isFig,
                title = title,
                onSchliessen = { showDeleteConfirm = false },
                onLoeschen = {
                    showDeleteConfirm = false
                    // Auch hier der Besitzer der Karte — sonst loescht der
                    // Server die Zeile des Aufrufers statt der angezeigten.
                    when {
                        isFig && rueckgaengig -> figuren.figurLoeschenVormerken(id, fig?.userId, title)
                        isFig -> figuren.deleteMinifig(id, fig?.userId)
                        rueckgaengig -> teile.teilLoeschenVormerken(id, colorId, part?.userId, title)
                        else -> teile.deletePart(id, colorId, part?.userId)
                    }
                    // Der Eintrag ist weg — dieser Screen zeigte sonst eine
                    // Karteileiche mit Mengenwahl und Kaufpreisen.
                    onBack()
                },
            )
        }

        if (showImageZoom && imageUrl != null) {
            ZoomableImageDialog(
                imageUrl = imageUrl,
                contentDescription = title,
                imageLoader = imageLoader,
                onDismiss = { showImageZoom = false }
            )
        }
    }
}

/** Menge mit Minus und Plus; was eine Änderung schreibt, entscheidet der Aufrufer. */
@Composable
private fun MengenZeile(menge: Int, onWeniger: () -> Unit, onMehr: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(stringResource(R.string.common_quantity),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
            MitTooltip(stringResource(R.string.cd_qty_decrease)) {
                MengenKnopf(onClick = onWeniger) { Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(mitSchrift(14.dp))) }
            }
            Text("$menge", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.widthIn(min = 24.dp), textAlign = TextAlign.Center)
            MitTooltip(stringResource(R.string.cd_qty_increase)) {
                MengenKnopf(onClick = onMehr) { Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase), Modifier.size(mitSchrift(14.dp))) }
            }
        }
    }
}

/** Rückfrage vor dem Löschen des Teils bzw. der Figur. */
@Composable
private fun LoeschenFrage(isFig: Boolean, title: String, onSchliessen: () -> Unit, onLoeschen: () -> Unit) {
    // Die gemeinsame Rückfrage wie beim Set: Titel als Überschrift und Fenstername, Text rollbar.
    Rueckfrage(
        titel = stringResource(if (isFig) R.string.minifigs_delete_title else R.string.parts_delete_title),
        text = stringResource(if (isFig) R.string.minifigs_delete_text else R.string.parts_delete_text, title),
        bestaetigen = stringResource(R.string.common_delete),
        onBestaetigen = onLoeschen,
        onAbbrechen = onSchliessen,
        symbol = Icons.Default.Delete,
    )
}
