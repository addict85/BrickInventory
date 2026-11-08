package ch.brickinventoryapp.sammlung.ui.screens

import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.ui.semantics.selected
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.LocalIsNoppeTheme
import ch.brickinventoryapp.ui.theme.LocalIstGlanz
import androidx.compose.foundation.shape.CircleShape
import ch.brickinventoryapp.ui.theme.steinTon
import ch.brickinventoryapp.ui.theme.BrickStudCap
import ch.brickinventoryapp.ui.theme.NoppenReihe
import ch.brickinventoryapp.ui.theme.SteinKantenVerlauf
import ch.brickinventoryapp.ui.theme.NoppenMass
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtProzent
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import androidx.compose.material3.ExperimentalMaterial3Api
import coil3.ImageLoader
import coil3.compose.AsyncImagePainter
import coil3.request.ImageRequest
import coil3.request.crossfade
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.vorgelesenAls
import androidx.compose.ui.res.pluralStringResource
import ch.brickinventoryapp.ui.components.GemeinsamesBild
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.theme.LocalIsFarbfaecherTheme
import ch.brickinventoryapp.ui.theme.LocalSteinDekor
import ch.brickinventoryapp.ui.theme.faecherTon
import ch.brickinventoryapp.ui.theme.lichtStreifen
import ch.brickinventoryapp.ui.screens.ConditionBadges
import ch.brickinventoryapp.ui.screens.OwnerBadges

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SetCard(
    set: SetAnsicht,
    serverUrl: String,
    imageLoader: ImageLoader,
    onClick: (String) -> Unit,
    /** Position in der Kachelwand — nur fuer die Deckelfarbe des Designs "noppe". */
    position: Int = 0,
    /** Marktpreis und G&V; fehlt beides, steht der Kaufpreis da (wie im Web). */
    preis: KachelPreis? = null,
    waehrung: String = "EUR",
    /** Steht das Detail dieses Sets daneben? Dann trägt die Kachel einen Rahmen. */
    ausgewaehlt: Boolean = false,
) {
    // Vorschaubild über den Server, mit Rückfall auf die volle Auflösung, solange die
    // `_thumb`-Datei fehlt (nach einem CSV-Import erzeugt der Server sie nachträglich)
    // — wie data-orig in der Webapp; siehe util/BildRueckfall.kt.
    val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)

    // Einmaliger, verzögerter Wiederholversuch nach einem Ladefehler: Direkt nach dem
    // Erfassen ist das Bild auf dem Server oft noch nicht fertig, und Coil wiederholt
    // eine gescheiterte Anfrage nie von selbst. An Setnummer und Adresse gebunden,
    // damit eine wiederverwendete Kachel neu zählt; memoryCacheKeyExtra("retry", …)
    // Ausführlich: docs/begruendungen/feature-sammlung/sammlung/ui/screens/GalleryScreen.kt.md#retrynonce-by-remember
    var retryNonce by remember(set.setNumber, imageUrl) { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    val isBrick = LocalIsBrickTheme.current
    val istNoppe = LocalIsNoppeTheme.current
    val istGlanz = LocalIstGlanz.current
    // Im Design "farbfaecher" trägt jede Kachel den Ton ihres Themas als Streifen, wie
    // im Katalog. Die Galerie kennt nur den Namen; derselbe Name ergibt denselben Ton.
    val ton = if (LocalIsFarbfaecherTheme.current)
        faecherTon(set.theme?.hashCode()) else null

    // Ab grosser Schrift eine Listenzeile, Bild links und Text rechts, wie die Merkliste:
    // Über die volle Breite nahm das Bild zwei Drittel der Höhe, und es stand ein Set je
    // Bildschirm. Die Plaketten rücken dann vom Bild in den Text, das Bild ist zu klein.
    val zeile = grosseSchrift()
    val pct = preis?.pnlPct
    val betrag = kachelBetrag(set, preis)
    // Was die Plaketten auf dem Bild sagen, liest TalkBack am Ende der Kachel: zuerst der Name.
    val guvAnsage = if (pct != null && betrag != null) stringResource(
        if (pct >= 0) R.string.gallery_pnl_gewinn else R.string.gallery_pnl_verlust, fmtProzent(pct)) else null
    val mengeAnsage = if (set.quantity > 1) pluralStringResource(R.plurals.gallery_stat_units, set.quantity, fmtInt(set.quantity)) else null
    val guv: (@Composable () -> Unit)? = if (pct != null && betrag != null) ({
        GuvPlakette(pct)
    }) else null
    val menge: (@Composable () -> Unit)? = if (set.quantity > 1) ({
        MengePlakette(set)
    }) else null

    // Die Bildfläche; in der Zeile ohne Plaketten und links statt oben gerundet.
    val bildflaeche: @Composable (Modifier) -> Unit = { flaeche ->
        KachelBild(flaeche, set, imageUrl, imageLoader, retryNonce, zeile, isBrick, istGlanz, guv, menge,
            onState = { st ->
                if (st is coil3.compose.AsyncImagePainter.State.Error && retryNonce == 0) {
                    // Verzögert, nicht im selben Moment: Direkt nach
                    // dem Erfassen erzeugt der Server die Vorschau
                    // erst noch.
                    scope.launch {
                        kotlinx.coroutines.delay(1000)
                        retryNonce = 1
                    }
                } else if (st is coil3.compose.AsyncImagePainter.State.Error) {
                    // Auch der zweite Versuch scheiterte — jetzt auf
                    // die volle Auflösung ausweichen (fehlende
                    // _thumb-Datei ist der häufigste Grund).
                    onImageError()
                }
            })
    }
    val texte: @Composable (Modifier) -> Unit = { spalte ->
        KachelTexte(spalte, set, zeile, ton, guv, menge, preis, betrag, waehrung, listOfNotNull(guvAnsage, mengeAnsage))
    }
    KachelRahmen(isBrick, istNoppe, istGlanz, position, ton, zeile, ausgewaehlt,
        onClick = { onClick(set.setNumber) }, bildflaeche = bildflaeche, texte = texte)
}

/**
 * G&V als Marke: In der Preiszeile brach sie neben „je Stück“ um, und die Kachel
 * wurde höher als ihre Nachbarin. Pfeil und Ansage „Gewinn …“: Eine nackte Zahl
 * sagte nur, wer die Finanzen kennt.
 */
@Composable
private fun GuvPlakette(pct: Double) {
    val farbe = if (pct >= 0) LocalStatusFarben.current.erfolg else MaterialTheme.colorScheme.error
    val ansage = stringResource(if (pct >= 0) R.string.gallery_pnl_gewinn else R.string.gallery_pnl_verlust,
        fmtProzent(pct))
    Surface(color = MaterialTheme.colorScheme.surface, shape = Formen.etikett) {
        Row(Modifier.padding(horizontal = Abstaende.winzig + Abstaende.haar, vertical = Abstaende.haar),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
            Icon(if (pct >= 0) Icons.AutoMirrored.Filled.TrendingUp else Icons.AutoMirrored.Filled.TrendingDown,
                null, Modifier.size(mitSchrift(12.dp)), tint = farbe)
            Text(fmtProzent(pct), Modifier.semantics { contentDescription = ansage },
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                color = farbe, maxLines = 1, softWrap = false)
        }
    }
}

/** Die Stückzahl als Marke, vorgelesen als Einheiten statt als „x2“. */
@Composable
private fun MengePlakette(set: SetAnsicht) {
    Surface(color = MaterialTheme.colorScheme.primary, shape = Formen.etikett) {
        Text(stringResource(R.string.gallery_quantity_badge, set.quantity), Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar)
            .vorgelesenAls(pluralStringResource(R.plurals.gallery_stat_units, set.quantity, fmtInt(set.quantity))),
            color = MaterialTheme.colorScheme.onPrimary,
            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}

/** Bild der Kachel mit Spiegelung und, ausser in der Zeile, den Plaketten darauf. */
@Composable
private fun KachelBild(
    flaeche: Modifier,
    set: SetAnsicht,
    imageUrl: String?,
    imageLoader: ImageLoader,
    retryNonce: Int,
    zeile: Boolean,
    isBrick: Boolean,
    istGlanz: Boolean,
    guv: (@Composable () -> Unit)?,
    menge: (@Composable () -> Unit)?,
    onState: (AsyncImagePainter.State) -> Unit,
) {
    val ctx = LocalContext.current
    // Weich einblenden nur, wenn Bewegung erwünscht ist (bewegungReduziert).
    val weich = !bewegungReduziert()
    Box(flaeche) {
        GemeinsamesBild(set.setNumber) { bild ->
            ProduktBild(
                model = imageUrl?.let { ImageRequest.Builder(ctx).data(it)
                    .memoryCacheKeyExtra("retry", retryNonce.toString())
                    .crossfade(weich).build() },
                imageLoader = imageLoader,
                // Ohne Beschreibung: Die Kachel fasst ihren Inhalt zusammen, und der
                // Name stand darunter schon als Text — TalkBack las ihn zweimal.
                contentDescription = null,
                onState = onState,
                // Randlos bis an die Kartenkanten: Der weisse Bildgrund nimmt die Fläche
                // ein, die ContentScale.Fit neben dem Bild frei lässt.
                modifier = bild
                    .fillMaxSize()
                    .then(when {
                        isBrick -> Modifier
                        zeile -> Modifier.clip(RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp))
                        else -> Modifier.clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                    }),
                contentScale = ContentScale.Fit,
                ersatzGroesse = if (zeile) 32.dp else 48.dp,
                bildgrund = true,
                innenAbstand = Abstaende.klein,
            )
        }
        // Die Spiegelung auf der Glasscheibe: über dem Bild, aber UNTER Plaketten und
        // Menü, damit die Bedienelemente auf eigener Fläche stehen (lichtStreifen()).
        if (istGlanz) Box(Modifier.matchParentSize().background(lichtStreifen()))
        // Die Kachel trägt keine zerstörerische Aktion: Gelöscht wird im Detail,
        // mit Rückfrage und danach „Rückgängig“. Plaketten mit Abstand innerhalb
        // des Bilds (PLAKETTE_RAND): Auf dessen Rand sassen sie über der Ecke.
        if (!zeile) {
            if (guv != null) Box(Modifier.align(Alignment.TopStart).padding(PLAKETTE_RAND).clearAndSetSemantics {}) { guv() }
            if (menge != null) Box(Modifier.align(Alignment.TopEnd).padding(PLAKETTE_RAND).clearAndSetSemantics {}) { menge() }
        }
    }
}

/**
 * Zustand und Besitzer unter dem Bild statt darüber: Über dem Bild brauchten sie
 * einen freien Streifen, der als Lücke zwischen Bild und „Neu“ stand.
 * Der Name zuerst, sichtbar wie vorgelesen: TalkBack las vorher Zustand und Nummer davor.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KachelTexte(
    spalte: Modifier,
    set: SetAnsicht,
    zeile: Boolean,
    ton: Color?,
    guv: (@Composable () -> Unit)?,
    menge: (@Composable () -> Unit)?,
    preis: KachelPreis?,
    betrag: Double?,
    waehrung: String,
    /** Was die Bildplaketten sagen; TalkBack liest es nach dem Preis. */
    ansagen: List<String>,
) {
    Box(spalte) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = Abstaende.klein), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
                maxLines = 2, minLines = if (zeile) 1 else 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                lineHeight = 16.sp)
            Text(set.setNumber, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.padding(vertical = Abstaende.haar), verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                // In der Zeile stehen die Plaketten vor dem Zustand in einer Reihe: Jede
                // eigene Zeile kostete bei 200 % ein Drittel der nächsten Zeile.
                if (zeile) FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.haar),
                ) {
                    guv?.invoke()
                    menge?.invoke()
                    ConditionBadges(set.conditions, set.condition)
                } else ConditionBadges(set.conditions, set.condition)
                // Wem gehört dieses Exemplar? Ohne die Angabe verschiebt
                // man im Haushalt das falsche.
                OwnerBadges(set.owners)
            }
            // Thema und Teilezahl in einer Zeile: Getrennt stand meist eine davon leer.
            // Im Farbfächer ein Punkt im Ton der Kartenleiste davor: So liest sich die
            // Leiste als Thema, nicht nur als Farbe.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                if (ton != null && !set.theme.isNullOrBlank()) Box(Modifier.size(8.dp).background(ton, CircleShape))
                Text(themaUndTeile(set.theme, set.pieces?.let { fmtInt(it) + stringResource(R.string.gallery_pieces_suffix) }),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            KachelBetragZeilen(set, zeile, preis, betrag, waehrung)
        }
        // Ohne Fläche: nur die Ansage der Bildplaketten, nach dem Preis.
        val plaketten = ansagen.takeIf { !zeile && it.isNotEmpty() }
        if (plaketten != null) Box(Modifier.semantics { contentDescription = plaketten.joinToString(", ") })
    }
}

/** Woher der Betrag kommt, darunter der Betrag und, bei mehreren Stück, „je Stück“. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun KachelBetragZeilen(set: SetAnsicht, zeile: Boolean, preis: KachelPreis?, betrag: Double?, waehrung: String) {
    // Wie im Web eine Zeile darüber, was der Betrag ist: Ohne Marktpreis ist es
    // der Kaufpreis (kachel_quelle), unbeschriftet las er sich als Marktwert.
    // Leer ohne Betrag, damit Kacheln einer Reihe gleich hoch bleiben; in der
    // Zeile steht die Bezeichnung vor dem Betrag, wenn die Breite reicht.
    val quelle = when (if (betrag != null) kachelQuelle(set, preis) else null) {
        KachelQuelle.MARKT -> stringResource(R.string.gallery_card_market)
        KachelQuelle.KAUF -> stringResource(R.string.gallery_card_paid)
        null -> ""
    }
    if (!zeile) Text(quelle, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1, overflow = TextOverflow.Ellipsis)
    // FlowRow und je eine Zeile: Reicht die Breite nicht, rückt „je Stück“ unter
    // den Betrag, statt Zeichen für Zeichen umzubrechen.
    if (betrag != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        if (zeile) Text(quelle, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false,
            modifier = Modifier.align(Alignment.CenterVertically))
        Text(fmtMoney(betrag, waehrung), style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.CenterVertically))
        // Der Betrag gilt je Stück; die Finanzen zeigen dasselbe Set mit dem Wert
        // aller Stück, und ohne Hinweis passten die Zahlen nicht zusammen.
        if (set.quantity > 1) Text(stringResource(R.string.gallery_price_each),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1, softWrap = false, modifier = Modifier.align(Alignment.CenterVertically))
    } else if (!zeile) Text("", style = MaterialTheme.typography.labelMedium)
}

/**
 * Die Noppen stehen über der Karte: Eine Material-Card klippt auf ihre Form.
 * Deshalb rückt die Karte um die Noppenhöhe nach unten, und die Reihe wird daneben
 * gezeichnet und darübergelegt — wie `top:-6px` im CSS.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KachelRahmen(
    isBrick: Boolean,
    istNoppe: Boolean,
    istGlanz: Boolean,
    position: Int,
    ton: Color?,
    zeile: Boolean,
    ausgewaehlt: Boolean,
    onClick: () -> Unit,
    bildflaeche: @Composable (Modifier) -> Unit,
    texte: @Composable (Modifier) -> Unit,
) {
    Box {
        AppKarte(
            modifier = Modifier
                .then(if (isBrick) Modifier.padding(top = NoppenMass.Stein.hoehe) else Modifier)
                .semantics { selected = ausgewaehlt }
                .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.karte) else Modifier),
            onClick = onClick,
            onClickLabel = stringResource(R.string.cd_details_oeffnen),
        ) {
            Column {
                // Die Steinkante mit den Massen aus themes/brick.css (NoppenMass.Stein), wie im
                // Web über die ganze Breite. Nur die Kante liegt in der Karte; die Noppen werden
                // daneben gezeichnet, weil die Card sie abschnitte.
                // Auf der schmalen Telefonkachel eine schlankere Kante: 22 dp nahmen dort dem Bild
                // sichtbar Platz; ab Tabletbreite die volle Höhe wie im Web.
                if (isBrick) BoxWithConstraints {
                    BrickStudCap(mass = NoppenMass.Stein, verlauf = SteinKantenVerlauf,
                        height = if (maxWidth < 240.dp) 12.dp else null)
                }
                // Der Steindeckel des Designs "noppe" — Position modulo sechs,
                // genau wie `.sc:nth-child(6n+…)` in themes/noppe.css. Dieselbe
                // Bauform wie beim Stein-Design, nur hoeher und in wechselnder
                // Farbe; deshalb derselbe Baustein statt eines zweiten.
                if (istNoppe) BrickStudCap(color = steinTon(position), glanz = istGlanz)
                if (ton != null) Box(Modifier.fillMaxWidth().height(5.dp).background(ton))
                // 4:3 wie die Setbilder selbst: Eine feste Höhe liess bei ContentScale.Fit
                // eine Lücke zwischen Bild und Text.
                if (zeile) Row(verticalAlignment = Alignment.Top) {
                    bildflaeche(Modifier.width(ZEILE_BILD_BREITE).aspectRatio(BILD_SEITENVERHAELTNIS))
                    texte(Modifier.weight(1f))
                } else {
                    bildflaeche(Modifier.fillMaxWidth().aspectRatio(BILD_SEITENVERHAELTNIS))
                    texte(Modifier)
                }
            }
        }
        if (isBrick) NoppenReihe(
            mass = NoppenMass.Stein,
            modifier = Modifier.align(Alignment.TopStart),
            farbe = LocalSteinDekor.current.noppen,
        )
    }
}

/** Breite des Vorschaubilds, wenn die Kachel bei grosser Schrift eine Listenzeile ist. */
private val ZEILE_BILD_BREITE = 96.dp

/** Seitenverhältnis der Bildfläche einer Kachel — das der Setbilder. */
internal const val BILD_SEITENVERHAELTNIS = 4f / 3f

/** Plaketten auf dem Bild: Innenabstand des Bilds plus ein Rand, damit sie nicht auf seiner Ecke sitzen. */
private val PLAKETTE_RAND = Abstaende.klein + Abstaende.winzig

/** „Star Wars · 7’541 Teile“ — das Thema in der Hauptfarbe, die Teilezahl leiser. */
@Composable
private fun themaUndTeile(thema: String?, teile: String?): androidx.compose.ui.text.AnnotatedString =
    androidx.compose.ui.text.buildAnnotatedString {
        if (!thema.isNullOrBlank()) {
            pushStyle(androidx.compose.ui.text.SpanStyle(color = MaterialTheme.colorScheme.primary))
            append(thema)
            pop()
        }
        if (!thema.isNullOrBlank() && teile != null) append(" · ")
        if (teile != null) append(teile)
    }
