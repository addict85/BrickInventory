package ch.brickinventoryapp.offline

import kotlinx.coroutines.flow.mapLatest
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.vertrag.FigValuationItem
import ch.brickinventoryapp.vertrag.Gutschein
import ch.brickinventoryapp.vertrag.LagerortEintrag
import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.Minifig
import ch.brickinventoryapp.vertrag.PartValuationItem
import ch.brickinventoryapp.vertrag.AddSetRequest
import ch.brickinventoryapp.vertrag.CatalogMetaResponse
import ch.brickinventoryapp.vertrag.StatsResponse
import ch.brickinventoryapp.vertrag.SetAggregate
import ch.brickinventoryapp.model.fach.Zustand
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
import ch.brickinventoryapp.offline.Ausgang.VerworfenerPosten
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Eine lokale Liste mit Typ, Schlüssel, ihrer [Ablageform], den Spalten, nach denen
 * sie gefiltert wird, und wie eine [Offlineablage.Wirkung] sie ändert — je Fach
 * getypt, damit die Ablage nichts umwandeln muss.
 */
class Fach<T : Any> internal constructor(
    val art: Bestandsart,
    internal val form: Ablageform<T, *>,
    val schluessel: (T) -> String,
    val anwenden: (List<T>, Offlineablage.Wirkung) -> List<T> = { l, _ -> l },
    val spalten: (T) -> Filterspalten = { Filterspalten() },
)

object Faecher {
    val SETS = Fach(Bestandsart.SETS, Ablageform(SetZeile.serializer(), Ablagezeilen::set, Ablagezeilen::set),
        { it.setNumber }, LokaleAnwendung::sets) {
        // Wie der Server: Nummer, Name, Thema und Jahr (ohne Jahr „0“).
        Filterspalten(suchtext(it.setNumber, it.name, it.theme.orEmpty(), (it.year ?: 0).toString()),
            thema = it.theme, lagerort = it.storage)
    }
    val MERKLISTE = Fach(Bestandsart.MERKLISTE, Ablageform(MerkZeile.serializer(), Ablagezeilen::merk, Ablagezeilen::merk),
        { LokaleAnwendung.merkSchluessel(it) }, LokaleAnwendung::merkliste) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }
    val TEILE = Fach(Bestandsart.TEILE, Ablageform(TeilZeile.serializer(), Ablagezeilen::teil, Ablagezeilen::teil),
        { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, spalten = {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), farbe = it.colorName,
            kategorie = it.categoryName, ersatzteil = it.isSpare)
    })
    val FIGUREN = Fach(Bestandsart.FIGUREN, Ablageform.direkt(Minifig.serializer()), { it.figNumber }, spalten = {
        Filterspalten(suchtext(it.figNumber, it.figName))
    })
    val MANUELLE_TEILE = Fach(Bestandsart.MANUELLE_TEILE, Ablageform.direkt(PartValuationItem.serializer()),
        { "${it.partNumber}|${it.colorId}|${it.userId}" }, LokaleAnwendung::manuelleTeile) {
        Filterspalten(suchtext(it.partNumber, it.partName, it.blPartNumber), lagerort = it.storage)
    }
    val MANUELLE_FIGUREN = Fach(Bestandsart.MANUELLE_FIGUREN, Ablageform.direkt(FigValuationItem.serializer()),
        { "${it.figNumber}|${it.userId}" }, LokaleAnwendung::manuelleFiguren) {
        Filterspalten(suchtext(it.figNumber, it.figName))
    }
    val GUTSCHEINE = Fach(Bestandsart.GUTSCHEINE, Ablageform.direkt(Gutschein.serializer()), { it.id.toString() })

    /** Je Set und Zustand höchstens ein Alarm, wie am Server. */
    val PREISALARME = Fach(Bestandsart.PREISALARME, Ablageform.direkt(Preisalarm.serializer()),
        { "${it.setNumber}|${it.condition.kennung}" }, LokaleAnwendung::preisalarme) {
        Filterspalten(suchtext(it.setNumber, it.name), zustand = it.condition.kennung)
    }

    /** Der eigene Vorrat an Lagerorten samt Vorgabe. */
    val LAGERORTE = Fach(Bestandsart.LAGERORTE, Ablageform(VorratZeile.serializer(), Ablagezeilen::vorrat, Ablagezeilen::vorrat),
        { it.ort.id.toString() }, LokaleAnwendung::lagerorte) {
        Filterspalten(suchtext(it.ort.name))
    }

    /**
     * Einzelne Antworten ohne Liste: je Bereich eine Zeile. Sie liegen wie die Listen in
     * Room, damit Abmelden, Bereich und Verschlüsselung für alles dieselben sind.
     */
    val KENNZAHLEN = Fach(Bestandsart.KENNZAHLEN, Ablageform.direkt(StatsResponse.serializer()), { EINZELN })
    val KATALOG_META = Fach(Bestandsart.KATALOG_META, Ablageform.direkt(CatalogMetaResponse.serializer()), { EINZELN })

    private const val EINZELN = "einzeln"

    private fun suchtext(vararg felder: String?) = felder.filterNotNull().joinToString("\n").lowercase()
}

/** Plant das Senden des Ausgangs; im Gerät über WorkManager (AusgangWorker). */
fun interface AusgangPlaner {
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
    private val bestand: LokalerBestand,
    /** Ein Test gibt einen SpeicherAusgang hinein und sieht dort nach; die Ablage zeigt ihn nicht. */
    private val ausgang: Ausgang,
    /** Der Bereich, wie er jetzt gilt: zum Schreiben und für den Vergleich vor und nach einem Abruf. */
    private val bereichQuelle: suspend () -> String?,
    private val planer: AusgangPlaner = AusgangPlaner {},
    private val uhr: () -> Long = System::currentTimeMillis,
    private val schluesselQuelle: () -> String = { UUID.randomUUID().toString() },
    /**
     * Derselbe Bereich als Fluss, zum Beobachten. Im Gerät ein StateFlow der
     * Sitzung; ohne ihn fragt jedes neue Beobachten die Quelle einmal.
     */
    bereichFluss: Flow<String?> = flow { emit(bereichQuelle()) },
    /** Wohin eine Meldung über Verworfenes geht; im Gerät das Log. */
    private val protokoll: (String) -> Unit = {},
    private val json: Json = BrickJson,
) {
    /**
     * Was ein Schreibvorgang an den lokalen Listen ändert. Zwei Arten, damit der Typ
     * sagt, was in den Ausgang darf: [Bearbeitung] wartet ohne Netz und wird
     * nachgesendet; [Nachzug] gibt es nur online und zieht nur die Ablage nach.
     */
    sealed interface Wirkung {
        /** Die Listen, die sich ändern. */
        val arten: Set<Bestandsart>
    }

    /**
     * Das Ergebnis eines Schreibvorgangs, der nur online geht, für die lokale Liste.
     * Ohne Ausgang: Was der Server dazu rechnet, bringt der nächste Abgleich.
     */
    sealed interface Nachzug : Wirkung {
        data class SetMengeGesetzt(val setNumber: String, val menge: Int) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        data class SetLagerort(val setNumber: String, val ort: String?) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        data class SetEntfernt(val setNumber: String) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        /** [alle]: Alle Käufe wandern, der alte Besitzer verschwindet von der Kachel. */
        data class SetVerschoben(val setNumber: String, val von: Int?, val zu: Int, val alle: Boolean) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        /** Ein geänderter Kauf: Der Server schickt die neue Zusammenfassung des Sets mit. */
        data class SetZusammenfassung(val agg: SetAggregate) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS)
        }

        data class MerkpostenVerschoben(val setNumber: String, val zustand: Zustand, val von: Int, val zu: Int) : Nachzug {
            override val arten get() = setOf(Bestandsart.MERKLISTE)
        }

        /** Der Merkposten geht in die Sammlung: weg aus der Merkliste, dazu in der Galerie. */
        data class MerkpostenUebernommen(val setNumber: String, val zustand: Zustand, val besitzer: Int?,
                                         val anfrage: AddSetRequest) : Nachzug {
            override val arten get() = setOf(Bestandsart.MERKLISTE, Bestandsart.SETS)
        }

        data class TeilLagerort(val partNumber: String, val colorId: Int, val ort: String?) : Nachzug {
            override val arten get() = setOf(Bestandsart.MANUELLE_TEILE)
        }

        /** Die Farbe ist Teil des Schlüssels: Trifft sie eine vorhandene Zeile, legt der Server beide zusammen. */
        data class TeilFarbe(val partNumber: String, val colorId: Int, val neueFarbe: Int, val farbName: String?,
                             val farbHex: String?, val besitzer: Int?) : Nachzug {
            override val arten get() = setOf(Bestandsart.MANUELLE_TEILE)
        }

        data class FigurLagerort(val figNumber: String, val ort: String?) : Nachzug {
            override val arten get() = setOf(Bestandsart.MANUELLE_FIGUREN)
        }

        /** Ein umbenannter Ort heisst überall neu, wo er stand, auch im Vorrat. */
        data class LagerortUmbenannt(val alt: String, val neu: LagerortEintrag) : Nachzug {
            override val arten get() = setOf(Bestandsart.SETS, Bestandsart.MANUELLE_TEILE, Bestandsart.MANUELLE_FIGUREN,
                Bestandsart.LAGERORTE)
        }

        data class LagerortAngelegt(val ort: LagerortEintrag) : Nachzug {
            override val arten get() = setOf(Bestandsart.LAGERORTE)
        }

        data class LagerortGeloescht(val id: Int) : Nachzug {
            override val arten get() = setOf(Bestandsart.LAGERORTE)
        }

        /** null: keine Vorgabe mehr. */
        data class LagerortVorgabe(val id: Int?) : Nachzug {
            override val arten get() = setOf(Bestandsart.LAGERORTE)
        }

        /** Der Server schickt den gespeicherten Alarm zurück; er ersetzt den des Sets im selben Zustand. */
        data class AlarmGesetzt(val alarm: Preisalarm) : Nachzug {
            override val arten get() = setOf(Bestandsart.PREISALARME)
        }

        data class AlarmEntfernt(val setNumber: String, val zustand: Zustand) : Nachzug {
            override val arten get() = setOf(Bestandsart.PREISALARME)
        }
    }

    private val aktuell: Flow<String?> = bereichFluss.map { gueltig(it) }.distinctUntilChanged()

    /**
     * Eine Sperre je Bereich und Liste: Lesen, Ändern und Schreiben einer Liste
     * dürfen sich nicht überholen, sonst überschreibt das spätere Schreiben das
     * frühere (verlorene Änderung).
     */
    private val sperren = ConcurrentHashMap<Pair<String, Bestandsart>, Mutex>()

    private fun sperre(b: String, art: Bestandsart) = sperren.getOrPut(b to art) { Mutex() }

    /** Der gültige Bereich, gestreut; null = nicht angemeldet, dann wird nichts abgelegt. */
    suspend fun bereich(): String? = gueltig(fangeAusserAbbruch { bereichQuelle() }.getOrNull())

    private fun gueltig(b: String?) = b?.takeIf { it.isNotBlank() }

    /** Was der Server abgelehnt hat und noch nicht gemeldet ist, für den aktuellen Bereich. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun verworfene(): Flow<List<VerworfenerPosten>> =
        aktuell.flatMapLatest { b -> if (b == null) flowOf(emptyList()) else ausgang.verworfene(b) }

    /** Der Hinweis zu [id] ist gezeigt; der Posten darf weg. */
    suspend fun quittiereVerworfen(id: String) {
        val b = bereich() ?: return
        ausgang.quittiereVerworfen(b, id)
    }

    /** Wie viele Bearbeitungen noch auf den Server warten. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun offene(): Flow<Int> = aktuell.flatMapLatest { b -> if (b == null) flowOf(0) else ausgang.anzahl(b) }

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> beobachte(fach: Fach<T>): Flow<Lokal<T>> = aktuell.flatMapLatest { b ->
        if (b == null) flowOf(Lokal(emptyList(), null))
        else bestand.beobachte(b, fach.art).map { dekodiere(fach, it) }
    }

    /**
     * Jede spätere Änderung an einer der [faecher] — für Kennzahlen, die der
     * Server über diese Listen rechnet. Die Ablage ist die Quelle: Was sie nicht
     * ändert, löst nichts aus.
     */
    fun veraendert(vararg faecher: Fach<*>): Flow<Unit> =
        merge(*faecher.map { f -> beobachte(f).map { it.liste }.distinctUntilChanged().drop(1).map { } }.toTypedArray())

    /**
     * Die lokale Liste, nur mit den Zeilen, die [filter] trifft — bei jeder Änderung
     * neu gefragt, damit offline Geändertes auch in einer gefilterten Ansicht erscheint.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T : Any> beobachte(fach: Fach<T>, filter: Filterspalten): Flow<Lokal<T>> =
        if (filter == Filterspalten()) beobachte(fach)
        else beobachte(fach).mapLatest { alle -> if (alle.stand == null) alle else filtere(fach, filter) ?: alle }

    suspend fun <T : Any> lies(fach: Fach<T>): Lokal<T>? {
        val b = bereich() ?: return null
        return dekodiere(fach, bestand.lies(b, fach.art))
    }

    /** Die lokale Liste, nur mit den Zeilen, die [filter] trifft; null, wenn niemand angemeldet ist. */
    suspend fun <T : Any> filtere(fach: Fach<T>, filter: Filterspalten): Lokal<T>? {
        val b = bereich() ?: return null
        return dekodiere(fach, bestand.filtere(b, fach.art, filter))
    }

    /** Die ganze Liste des Servers übernehmen; noch Wartendes liegt danach wieder darüber. */
    suspend fun <T : Any> uebernimm(fach: Fach<T>, liste: List<T>, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        bestand.raeumeAndere(b)
        // Unter der Sperre: Ein puffere() zwischen dem Lesen des Ausgangs und dem
        // Schreiben ginge sonst mit der Serverliste verloren.
        sperre(b, fach.art).withLock {
            val wartend = ausgang.alle(b).map { it.bearbeitung }.filter { it.art == fach.art }
            var zusammen = liste
            for (w in wartend) zusammen = fach.anwenden(zusammen, w)
            bestand.ersetze(b, fach.art, kodiere(fach, zusammen), uhr())
        }
    }

    /**
     * Wartet für den aktuellen Bereich noch etwas (für [art] oder überhaupt)?
     * Dann muss Neues dahinter, sonst kippt die Reihenfolge.
     */
    suspend fun wartet(art: Bestandsart? = null): Boolean {
        val b = bereich() ?: return false
        return if (art == null) ausgang.erster(b) != null else ausgang.alle(b).any { it.bearbeitung.art == art }
    }

    /**
     * Ein neuer Idempotency-Key. Er entsteht vor dem ersten Versuch, damit ein
     * direkter Versuch und seine Wiederholung aus dem Ausgang denselben tragen.
     */
    fun neuerSchluessel(): String = schluesselQuelle()

    /**
     * Bearbeitung in den Ausgang legen und lokal anwenden. false, wenn niemand
     * angemeldet ist — dann gibt es keinen Ort, dem sie gehört.
     */
    suspend fun puffere(bearbeitung: Bearbeitung, schluessel: String = neuerSchluessel()): Boolean {
        val b = bereich() ?: return false
        // Einreihen und Anwenden in einem Zug: uebernimm() sieht beides oder keines.
        sperre(b, bearbeitung.art).withLock {
            ausgang.einreihen(b, bearbeitung, uhr(), schluessel)
            wendeAnGesperrt(bearbeitung.art, bearbeitung, b)
        }
        runCatching { planer.plane() }
        return true
    }

    /** Was online gelang, auch lokal anwenden, damit die Liste sofort stimmt. */
    suspend fun wendeAn(wirkung: Wirkung, bereich: String? = null) {
        val b = bereich ?: bereich() ?: return
        // Je Liste nacheinander, nie zwei Sperren zugleich: So kann sich nichts verklemmen.
        for (art in wirkung.arten) sperre(b, art).withLock { wendeAnGesperrt(art, wirkung, b) }
    }

    private suspend fun wendeAnGesperrt(art: Bestandsart, w: Wirkung, b: String) = when (art) {
        Bestandsart.SETS -> aendere(Faecher.SETS, b, w)
        Bestandsart.MERKLISTE -> aendere(Faecher.MERKLISTE, b, w)
        Bestandsart.MANUELLE_TEILE -> aendere(Faecher.MANUELLE_TEILE, b, w)
        Bestandsart.MANUELLE_FIGUREN -> aendere(Faecher.MANUELLE_FIGUREN, b, w)
        Bestandsart.PREISALARME -> aendere(Faecher.PREISALARME, b, w)
        Bestandsart.LAGERORTE -> aendere(Faecher.LAGERORTE, b, w)
        // Nur vom Server geliefert, nie lokal bearbeitet.
        Bestandsart.TEILE, Bestandsart.FIGUREN, Bestandsart.GUTSCHEINE, Bestandsart.KENNZAHLEN,
        Bestandsart.KATALOG_META -> Unit
    }

    /** Senden anstossen, z. B. beim Start, falls vom letzten Mal noch etwas wartet. */
    fun planeSenden() = runCatching { planer.plane() }

    /** Beim Abmelden: Listen und Ausgang aller Bereiche. */
    suspend fun leere() {
        bestand.leere()
        ausgang.leere()
    }

    /** Nur unter der Sperre von ([b], fach.art) aufrufen. */
    private suspend fun <T : Any> aendere(fach: Fach<T>, b: String, w: Wirkung) {
        val alt = dekodiere(fach, bestand.lies(b, fach.art))
        bestand.gleicheAn(b, fach.art, kodiere(fach, fach.anwenden(alt.liste, w)))
    }

    private fun <T : Any> kodiere(fach: Fach<T>, liste: List<T>) =
        liste.map { LokaleZeile(fach.schluessel(it), fach.form.kodiere(json, it), fach.spalten(it)) }

    /**
     * Zeilen, die sich nicht mehr lesen lassen, fallen weg statt die Liste zu sperren —
     * aber nicht still: Ihre Zahl steht in [Lokal.verworfen] und geht ins [protokoll].
     */
    private fun <T : Any> dekodiere(fach: Fach<T>, l: Lokal<LokaleZeile>): Lokal<T> {
        val gelesen = l.liste.mapNotNull { z -> runCatching { fach.form.dekodiere(json, z.inhalt) }.getOrNull() }
        val verworfen = l.liste.size - gelesen.size
        if (verworfen > 0) protokoll("Ablage ${fach.art}: $verworfen von ${l.liste.size} Zeilen unlesbar, verworfen")
        return Lokal(gelesen, l.stand, verworfen)
    }
}
