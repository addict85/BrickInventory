package ch.brickinventoryapp.offline.room

import ch.brickinventoryapp.offline.AblageJson
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.Ausgangsposten
import ch.brickinventoryapp.offline.Ausgangsform
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.offline.LokaleZeile
import ch.brickinventoryapp.offline.LokalerBestand
import ch.brickinventoryapp.offline.Ausgang.VerworfenerPosten
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import javax.inject.Inject

/** [LokalerBestand] über Room: Zeilen und Stand je Bereich und Art. */
internal class RoomBestand @Inject constructor(private val db: BestandDatenbank) : LokalerBestand {
    private val dao get() = db.bestand()

    override fun beobachte(bereich: String, art: Bestandsart): Flow<Lokal<LokaleZeile>> =
        combine(dao.beobachte(bereich, art.name), dao.beobachteStand(bereich, art.name)) { zeilen, stand ->
            Lokal(zeilen.map(::alsLokal), stand)
        }

    override suspend fun lies(bereich: String, art: Bestandsart) =
        Lokal(dao.lies(bereich, art.name).map(::alsLokal), dao.stand(bereich, art.name))

    override suspend fun filtere(bereich: String, art: Bestandsart, filter: Filterspalten): Lokal<LokaleZeile> {
        val f = filter
        val zeilen = dao.filtere(bereich, art.name, f.suchtext?.let(::enthaeltMuster), f.thema, f.lagerort, f.farbe,
            f.kategorie, f.ersatzteil, f.zustand)
        return Lokal(zeilen.map(::alsLokal), dao.stand(bereich, art.name))
    }

    override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) =
        dao.ersetze(bereich, art.name,
            // Doppelte Schlüssel verletzten den Primärschlüssel; die spätere Zeile gilt.
            zeilen.associateBy { it.schluessel }.values.mapIndexed { i, z -> alsZeile(z, bereich, art, i) },
            stand)

    override suspend fun gleicheAn(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>) =
        dao.gleicheAn(bereich, art.name, zeilen.associateBy { it.schluessel }.values.mapIndexed { i, z -> alsZeile(z, bereich, art, i) })

    override suspend fun raeumeAndere(bereich: String) {
        dao.loescheAndereZeilen(bereich)
        dao.loescheAndereStaende(bereich)
    }

    override suspend fun leere() {
        dao.leereZeilen()
        dao.leereStaende()
    }
}

private fun alsLokal(z: BestandZeile) = with(z) {
    LokaleZeile(schluessel, inhalt, Filterspalten(suchtext, thema, lagerort, farbe, kategorie, ersatzteil, zustand))
}

private fun alsZeile(z: LokaleZeile, bereich: String, art: Bestandsart, position: Int) = with(z.spalten) {
    BestandZeile(bereich, art.name, z.schluessel, position, z.inhalt, suchtext.orEmpty(), thema, lagerort, farbe, kategorie,
        ersatzteil, zustand)
}

/** „Enthält“ als LIKE-Muster; `%`, `_` und `\` gelten wörtlich wie beim Server (likeSuche.ts). */
internal fun enthaeltMuster(suche: String): String =
    "%" + suche.lowercase().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

/**
 * [Ausgang] über Room; jeder Posten liegt in der [Ausgangsform]. Lesen schreibt nie:
 * Ein unlesbarer Posten bleibt liegen, bis [raeumeUnlesbare] ihn als verworfen meldet.
 */
internal class RoomAusgang @Inject constructor(private val db: BestandDatenbank) : Ausgang {
    private val dao get() = db.ausgang()

    override fun anzahl(bereich: String) = dao.anzahl(bereich)

    override suspend fun einreihen(bereich: String, bearbeitung: Bearbeitung, jetzt: Long, schluessel: String) =
        dao.fuegeEin(AusgangZeile(bereich = bereich, bearbeitung = Ausgangsform.kodiere(AblageJson, bearbeitung),
            erstellt = jetzt, schluessel = schluessel))

    override suspend fun alle(bereich: String) = dao.alle(bereich).mapNotNull { lies(it) }

    override suspend fun erster(bereich: String): Ausgangsposten? = dao.alle(bereich).firstNotNullOfOrNull { lies(it) }

    override suspend fun raeumeUnlesbare(bereich: String): Int {
        val unlesbar = dao.alle(bereich).filter { lies(it) == null }
        for (z in unlesbar) {
            // Erst den Hinweis festhalten, dann entfernen: Stirbt der Prozess dazwischen, bleibt der Hinweis.
            val ziel = Ausgangsform.zielAus(AblageJson, z.bearbeitung) ?: "?"
            merkeVerworfen(bereich, VerworfenerPosten(z.schluessel.ifBlank { "posten-${z.id}" }, ziel, "", null, unlesbar = true))
            dao.entferne(z.id)
        }
        return unlesbar.size
    }

    override suspend fun entferne(id: Long) = dao.entferne(id)
    override suspend fun versuchGescheitert(id: Long) = dao.versuchGescheitert(id)
    override suspend fun leere() = dao.leere()

    // Verworfenes liegt als eigene Art in der Tabelle `bestand`: dauerhaft ohne neues Schema,
    // und Abmelden (Bestand leeren) räumt es mit.
    private val bestand get() = db.bestand()

    override suspend fun merkeVerworfen(bereich: String, v: VerworfenerPosten) {
        val position = bestand.lies(bereich, VERWORFEN).maxOfOrNull { it.position }?.plus(1) ?: 0
        val inhalt = AblageJson.encodeToString(VerworfenZeile.serializer(), VerworfenZeile(v.ziel, v.meldung, v.httpCode, v.unlesbar))
        bestand.loesche(bereich, VERWORFEN, listOf(v.id))
        bestand.fuegeEin(listOf(BestandZeile(bereich, VERWORFEN, v.id, position, inhalt)))
    }

    override fun verworfene(bereich: String): Flow<List<VerworfenerPosten>> =
        bestand.beobachte(bereich, VERWORFEN).map { zeilen ->
            zeilen.mapNotNull { z ->
                runCatching { AblageJson.decodeFromString(VerworfenZeile.serializer(), z.inhalt) }.getOrNull()
                    ?.let { VerworfenerPosten(z.schluessel, it.ziel, it.meldung, it.httpCode, it.unlesbar) }
            }
        }

    override suspend fun quittiereVerworfen(bereich: String, id: String) = bestand.loesche(bereich, VERWORFEN, listOf(id))

    private fun lies(z: AusgangZeile): Ausgangsposten? =
        runCatching { Ausgangsform.dekodiere(AblageJson, z.bearbeitung) }.getOrNull()
            ?.let { Ausgangsposten(z.id, it, z.erstellt, z.versuche, z.schluessel) }
}

/** Die Art, unter der verworfene Posten in `bestand` liegen; keine [Bestandsart] heisst so. */
internal const val VERWORFEN = "AUSGANG_VERWORFEN"

@Serializable
internal data class VerworfenZeile(val ziel: String, val meldung: String, val httpCode: Int? = null, val unlesbar: Boolean = false)
