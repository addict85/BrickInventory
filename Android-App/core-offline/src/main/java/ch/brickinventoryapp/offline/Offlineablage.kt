package ch.brickinventoryapp.offline

import kotlinx.coroutines.flow.mapLatest
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.Setzusammenfassung
import ch.brickinventoryapp.model.domain.Zustand
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ch.brickinventoryapp.offline.Ausgang.DiscardedItem
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Eine lokale Liste mit Typ, Schlüssel, ihrer [Ablageform], den Spalten, nach denen
 * sie gefiltert wird, und wie eine [Offlineablage.Wirkung] sie ändert — je Fach
 * getypt, damit die Ablage nichts umwandeln muss.
 */
class Fach<T : Any> internal constructor(
    val art: StockKind,
    internal val form: Ablageform<T, *>,
    val schluessel: (T) -> String,
    val anwenden: (List<T>, Offlineablage.Wirkung) -> List<T> = { l, _ -> l },
    val spalten: (T) -> Filterspalten = { Filterspalten() },
)

object Slots {
    val SETS = Fach(StockKind.SETS, Ablageform(SetRow.serializer(), Ablagezeilen::set, Ablagezeilen::set),
        { it.setNumber }, LocalApplication::sets) {
        // Wie der Server: Nummer, Name, Thema und Jahr (ohne Jahr „0“).
        Filterspalten(suchtext(it.setNumber, it.name, it.theme.orEmpty(), (it.year ?: 0).toString()),
            thema = it.theme, lagerort = it.storage)
    }
    val MERKLISTE = Fach(StockKind.MERKLISTE, Ablageform(RememberRow.serializer(), Ablagezeilen::remember, Ablagezeilen::remember),
        { LocalApplication.rememberKey(it) }, LocalApplication::merkliste) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }
    val TEILE = Fach(StockKind.TEILE, Ablageform(PartRow.serializer(), Ablagezeilen::teil, Ablagezeilen::teil),
        { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, spalten = {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), farbe = it.colorName,
            kategorie = it.categoryName, ersatzteil = it.isSpare)
    })
    val FIGUREN = Fach(StockKind.FIGUREN, Ablageform(MinifigRow.serializer(), Ablagezeilen::figur, Ablagezeilen::figur),
        { it.figNumber }, spalten = {
        Filterspalten(suchtext(it.figNumber, it.figName))
    })
    val MANUELLE_TEILE = Fach(StockKind.MANUELLE_TEILE,
        Ablageform(ManualPartRow.serializer(), Ablagezeilen::manualPart, Ablagezeilen::manualPart),
        { "${it.partNumber}|${it.colorId}|${it.userId}" }, LocalApplication::manuelleTeile) {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), lagerort = it.storage)
    }
    val MANUELLE_FIGUREN = Fach(StockKind.MANUELLE_FIGUREN,
        Ablageform(ManualMinifigRow.serializer(), Ablagezeilen::manualMinifig, Ablagezeilen::manualMinifig),
        { "${it.figNumber}|${it.userId}" }, LocalApplication::manualMinifigs) {
        Filterspalten(suchtext(it.figNumber, it.figName))
    }
    val GUTSCHEINE = Fach(StockKind.GUTSCHEINE, Ablageform(VoucherRow.serializer(), Ablagezeilen::gutschein, Ablagezeilen::gutschein),
        { it.id.toString() })

    /** Je Set und Zustand höchstens ein Alarm, wie am Server. */
    val PREISALARME = Fach(StockKind.PREISALARME, Ablageform(AlarmRow.serializer(), Ablagezeilen::alarm, Ablagezeilen::alarm),
        { "${it.setNumber}|${it.condition.kennung}" }, LocalApplication::preisalarme) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }

    /** Der eigene Vorrat an Lagerorten samt Vorgabe. */
    val LAGERORTE = Fach(StockKind.LAGERORTE, Ablageform(StockRow.serializer(), Ablagezeilen::stock, Ablagezeilen::stock),
        { it.ort.id.toString() }, LocalApplication::lagerorte) {
        Filterspalten(suchtext(it.ort.name))
    }

    /**
     * Einzelne Antworten ohne Liste: je Bereich eine Zeile. Sie liegen wie die Listen in
     * Room, damit Abmelden, Bereich und Verschlüsselung für alles dieselben sind.
     */
    val KENNZAHLEN = Fach(StockKind.KENNZAHLEN,
        Ablageform(MetricsRow.serializer(), Ablagezeilen::metrics, Ablagezeilen::metrics), { SINGLE })
    val KATALOG_META = Fach(StockKind.KATALOG_META,
        Ablageform(CatalogMetaRow.serializer(), Ablagezeilen::catalogMeta, Ablagezeilen::catalogMeta), { SINGLE })

    private const val SINGLE = "einzeln"

    private fun suchtext(vararg felder: String?) = felder.filterNotNull().joinToString("\n").lowercase()
}

/** Plant das Senden des Ausgangs; im Gerät über WorkManager (ExitWorker). */
fun interface ExitPlanner {
    fun plane()
}

/**
 * Die lokale Wahrheit der Oberfläche: Listen und Ausgang je Bereich (Server und
 * Konto). Der Server bleibt massgeblich — was er liefert, ersetzt die Liste;
 * noch nicht gesendete Bearbeitungen werden danach wieder darübergelegt, damit
 * sie nicht kurz verschwinden, bis der Ausgang leer ist. Gebaut wird sie in
 * core-data, das den Bereich des angemeldeten Kontos kennt.
 */
class Offlineablage(
    private val bestand: LocalInventory,
    /** Ein Test gibt einen StorageExit hinein und sieht dort nach; die Ablage zeigt ihn nicht. */
    private val ausgang: Ausgang,
    /** Der Bereich, wie er jetzt gilt: zum Schreiben und für den Vergleich vor und nach einem Abruf. */
    private val areaSource: suspend () -> String?,
    private val planner: ExitPlanner = ExitPlanner {},
    private val clock: () -> Long = System::currentTimeMillis,
    private val keySource: () -> String = { UUID.randomUUID().toString() },
    /**
     * Derselbe Bereich als Fluss, zum Beobachten. Im Gerät ein StateFlow der
     * Sitzung; ohne ihn fragt jedes neue Beobachten die Quelle einmal.
     */
    areaFlow: Flow<String?> = flow { emit(areaSource()) },
    /** Wohin eine Meldung über Verworfenes geht; im Gerät das Log. */
    private val protokoll: (String) -> Unit = {},
    private val json: Json = BrickJson,
) {
    /**
     * Was ein Schreibvorgang an den lokalen Listen ändert. Zwei Arten, damit der Typ
     * sagt, was in den Ausgang darf: [Editing] wartet ohne Netz und wird
     * nachgesendet; [FollowUp] gibt es nur online und zieht nur die Ablage nach.
     */
    sealed interface Wirkung {
        /** Die Listen, die sich ändern. */
        val kinds: Set<StockKind>
    }

    /**
     * Das Ergebnis eines Schreibvorgangs, der nur online geht, für die lokale Liste.
     * Ohne Ausgang: Was der Server dazu rechnet, bringt der nächste Abgleich.
     */
    sealed interface FollowUp : Wirkung {
        data class SetQuantitySet(val setNumber: String, val menge: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class SetLocation(val setNumber: String, val ort: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class SetRemoved(val setNumber: String) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        /** [alle]: Alle Käufe wandern, der alte Besitzer verschwindet von der Kachel. */
        data class SetMoved(val setNumber: String, val von: Int?, val zu: Int, val alle: Boolean) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        /** Ein geänderter Kauf: Der Server schickt die neue Zusammenfassung des Sets mit. */
        data class SetSummary(val agg: Setzusammenfassung) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS)
        }

        data class WantedItemMoved(val setNumber: String, val zustand: Zustand, val von: Int, val zu: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.MERKLISTE)
        }

        /** Der Merkposten geht in die Sammlung: weg aus der Merkliste, dazu in der Galerie. */
        data class WantedItemAdopted(val setNumber: String, val zustand: Zustand, val besitzer: Int?,
                                         val wish: Erfassungswunsch) : FollowUp {
            override val kinds get() = setOf(StockKind.MERKLISTE, StockKind.SETS)
        }

        data class PartLocation(val partNumber: String, val colorId: Int, val ort: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUELLE_TEILE)
        }

        /** Die Farbe ist Teil des Schlüssels: Trifft sie eine vorhandene Zeile, legt der Server beide zusammen. */
        data class PartColor(val partNumber: String, val colorId: Int, val neueFarbe: Int, val farbName: String?,
                             val farbHex: String?, val besitzer: Int?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUELLE_TEILE)
        }

        data class MinifigLocation(val figNumber: String, val ort: String?) : FollowUp {
            override val kinds get() = setOf(StockKind.MANUELLE_FIGUREN)
        }

        /** Ein umbenannter Ort heisst überall neu, wo er stand, auch im Vorrat. */
        data class LocationRenamed(val alt: String, val neu: LocationEntryView) : FollowUp {
            override val kinds get() = setOf(StockKind.SETS, StockKind.MANUELLE_TEILE, StockKind.MANUELLE_FIGUREN,
                StockKind.LAGERORTE)
        }

        data class LocationCreated(val ort: LocationEntryView) : FollowUp {
            override val kinds get() = setOf(StockKind.LAGERORTE)
        }

        data class LocationDeleted(val id: Int) : FollowUp {
            override val kinds get() = setOf(StockKind.LAGERORTE)
        }

        /** null: keine Vorgabe mehr. */
        data class LocationDefault(val id: Int?) : FollowUp {
            override val kinds get() = setOf(StockKind.LAGERORTE)
        }

        /** Der Server schickt den gespeicherten Alarm zurück; er ersetzt den des Sets im selben Zustand. */
        data class AlarmSet(val alarm: PriceAlertView) : FollowUp {
            override val kinds get() = setOf(StockKind.PREISALARME)
        }

        data class AlarmRemoved(val setNumber: String, val zustand: Zustand) : FollowUp {
            override val kinds get() = setOf(StockKind.PREISALARME)
        }
    }

    private val aktuell: Flow<String?> = areaFlow.map { gueltig(it) }.distinctUntilChanged()

    /**
     * Eine Sperre je Bereich und Liste: Lesen, Ändern und Schreiben einer Liste
     * dürfen sich nicht überholen, sonst überschreibt das spätere Schreiben das
     * frühere (verlorene Änderung).
     */
    private val sperren = ConcurrentHashMap<Pair<String, StockKind>, Mutex>()

    private fun lock(b: String, art: StockKind) = sperren.getOrPut(b to art) { Mutex() }

    /** Der gültige Bereich, gestreut; null = nicht angemeldet, dann wird nichts abgelegt. */
    suspend fun bereich(): String? = gueltig(fangeAusserAbbruch { areaSource() }.getOrNull())

    private fun gueltig(b: String?) = b?.takeIf { it.isNotBlank() }

    /** Was der Server abgelehnt hat und noch nicht gemeldet ist, für den aktuellen Bereich. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun discarded(): Flow<List<DiscardedItem>> =
        aktuell.flatMapLatest { b -> if (b == null) flowOf(emptyList()) else ausgang.discarded(b) }

    /** Der Hinweis zu [id] ist gezeigt; der Posten darf weg. */
    suspend fun acknowledgeDiscarded(id: String) {
        val b = bereich() ?: return
        ausgang.acknowledgeDiscarded(b, id)
    }

    /** Wie viele Bearbeitungen noch auf den Server warten. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun offene(): Flow<Int> = aktuell.flatMapLatest { b -> if (b == null) flowOf(0) else ausgang.anzahl(b) }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> observe(fach: Fach<T>): Flow<Local<T>> = aktuell.flatMapLatest { b ->
        if (b == null) flowOf(Local(emptyList(), null))
        else bestand.observe(b, fach.art).map { decode(fach, it) }
    }

    /**
     * Jede spätere Änderung an einer der [slots] — für Kennzahlen, die der
     * Server über diese Listen rechnet. Die Ablage ist die Quelle: Was sie nicht
     * ändert, löst nichts aus.
     */
    fun altered(vararg slots: Fach<*>): Flow<Unit> =
        merge(*slots.map { f -> observe(f).map { it.liste }.distinctUntilChanged().drop(1).map { } }.toTypedArray())

    /**
     * Die lokale Liste, nur mit den Zeilen, die [filter] trifft — bei jeder Änderung
     * neu gefragt, damit offline Geändertes auch in einer gefilterten Ansicht erscheint.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> observe(fach: Fach<T>, filter: Filterspalten): Flow<Local<T>> =
        if (filter == Filterspalten()) observe(fach)
        else observe(fach).mapLatest { alle -> if (alle.stand == null) alle else filtere(fach, filter) ?: alle }

    suspend fun <T : Any> lies(fach: Fach<T>): Local<T>? {
        val b = bereich() ?: return null
        return decode(fach, bestand.lies(b, fach.art))
    }

    /** Die lokale Liste, nur mit den Zeilen, die [filter] trifft; null, wenn niemand angemeldet ist. */
    suspend fun <T : Any> filtere(fach: Fach<T>, filter: Filterspalten): Local<T>? {
        val b = bereich() ?: return null
        return decode(fach, bestand.filtere(b, fach.art, filter))
    }

    /** Die ganze Liste des Servers übernehmen; noch Wartendes liegt danach wieder darüber. */
    suspend fun <T : Any> adopt(fach: Fach<T>, liste: List<T>, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        bestand.cleanOther(b)
        // Unter der Sperre: Ein puffere() zwischen dem Lesen des Ausgangs und dem
        // Schreiben ginge sonst mit der Serverliste verloren.
        lock(b, fach.art).withLock {
            val waiting = ausgang.alle(b).map { it.bearbeitung }.filter { it.art == fach.art }
            var zusammen = liste
            for (w in waiting) zusammen = fach.anwenden(zusammen, w)
            bestand.ersetze(b, fach.art, encode(fach, zusammen), clock())
        }
    }

    /**
     * Wartet für den aktuellen Bereich noch etwas (für [art] oder überhaupt)?
     * Dann muss Neues dahinter, sonst kippt die Reihenfolge.
     */
    suspend fun wartet(art: StockKind? = null): Boolean {
        val b = bereich() ?: return false
        return if (art == null) ausgang.erster(b) != null else ausgang.alle(b).any { it.bearbeitung.art == art }
    }

    /**
     * Ein neuer Idempotency-Key. Er entsteht vor dem ersten Versuch, damit ein
     * direkter Versuch und seine Wiederholung aus dem Ausgang denselben tragen.
     */
    fun newKey(): String = keySource()

    /**
     * Bearbeitung in den Ausgang legen und lokal anwenden. false, wenn niemand
     * angemeldet ist — dann gibt es keinen Ort, dem sie gehört.
     */
    suspend fun buffer(bearbeitung: Editing, schluessel: String = newKey()): Boolean {
        val b = bereich() ?: return false
        // Einreihen und Anwenden in einem Zug: uebernimm() sieht beides oder keines.
        lock(b, bearbeitung.art).withLock {
            ausgang.einreihen(b, bearbeitung, clock(), schluessel)
            applyAnLocked(bearbeitung.art, bearbeitung, b)
        }
        runCatching { planner.plane() }
        return true
    }

    /** Was online gelang, auch lokal anwenden, damit die Liste sofort stimmt. */
    suspend fun applyAn(effect: Wirkung, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        // Je Liste nacheinander, nie zwei Sperren zugleich: So kann sich nichts verklemmen.
        for (art in effect.kinds) lock(b, art).withLock { applyAnLocked(art, effect, b) }
    }

    private suspend fun applyAnLocked(art: StockKind, w: Wirkung, b: String) = when (art) {
        StockKind.SETS -> aendere(Slots.SETS, b, w)
        StockKind.MERKLISTE -> aendere(Slots.MERKLISTE, b, w)
        StockKind.MANUELLE_TEILE -> aendere(Slots.MANUELLE_TEILE, b, w)
        StockKind.MANUELLE_FIGUREN -> aendere(Slots.MANUELLE_FIGUREN, b, w)
        StockKind.PREISALARME -> aendere(Slots.PREISALARME, b, w)
        StockKind.LAGERORTE -> aendere(Slots.LAGERORTE, b, w)
        // Nur vom Server geliefert, nie lokal bearbeitet.
        StockKind.TEILE, StockKind.FIGUREN, StockKind.GUTSCHEINE, StockKind.KENNZAHLEN,
        StockKind.KATALOG_META -> Unit
    }

    /** Senden anstossen, z. B. beim Start, falls vom letzten Mal noch etwas wartet. */
    fun sendPlane() = runCatching { planner.plane() }

    /** Beim Abmelden: Listen und Ausgang aller Bereiche. */
    suspend fun leere() {
        bestand.leere()
        ausgang.leere()
    }

    /** Nur unter der Sperre von ([b], fach.art) aufrufen. */
    private suspend fun <T : Any> aendere(fach: Fach<T>, b: String, w: Wirkung) {
        val alt = decode(fach, bestand.lies(b, fach.art))
        bestand.sameAn(b, fach.art, encode(fach, fach.anwenden(alt.liste, w)))
    }

    private fun <T : Any> encode(fach: Fach<T>, liste: List<T>) =
        liste.map { LocalRow(fach.schluessel(it), fach.form.encode(json, it), fach.spalten(it)) }

    /**
     * Zeilen, die sich nicht mehr lesen lassen, fallen weg statt die Liste zu sperren —
     * aber nicht still: Ihre Zahl steht in [Local.verworfen] und geht ins [protokoll].
     */
    private fun <T : Any> decode(fach: Fach<T>, l: Local<LocalRow>): Local<T> {
        val gelesen = l.liste.mapNotNull { z -> runCatching { fach.form.decode(json, z.inhalt) }.getOrNull() }
        val verworfen = l.liste.size - gelesen.size
        if (verworfen > 0) protokoll("Ablage ${fach.art}: $verworfen von ${l.liste.size} Zeilen unlesbar, verworfen")
        return Local(gelesen, l.stand, verworfen)
    }
}
