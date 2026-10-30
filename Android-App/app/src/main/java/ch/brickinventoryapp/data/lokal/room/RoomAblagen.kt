package ch.brickinventoryapp.data.lokal.room

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.lokal.Ausgang
import ch.brickinventoryapp.data.lokal.Ausgangsposten
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Bestandsart
import ch.brickinventoryapp.data.lokal.LokaleListe
import ch.brickinventoryapp.data.lokal.LokaleZeile
import ch.brickinventoryapp.data.lokal.LokalerBestand
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject

/** [LokalerBestand] über Room: Zeilen und Stand je Bereich und Art. */
class RoomBestand @Inject constructor(private val db: BestandDatenbank) : LokalerBestand {
    private val dao get() = db.bestand()

    override fun beobachte(bereich: String, art: Bestandsart): Flow<LokaleListe> =
        combine(dao.beobachte(bereich, art.name), dao.beobachteStand(bereich, art.name)) { zeilen, stand ->
            LokaleListe(zeilen.map { LokaleZeile(it.schluessel, it.inhalt) }, stand)
        }

    override suspend fun lies(bereich: String, art: Bestandsart) =
        LokaleListe(dao.lies(bereich, art.name).map { LokaleZeile(it.schluessel, it.inhalt) }, dao.stand(bereich, art.name))

    override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) =
        dao.ersetze(bereich, art.name,
            // Doppelte Schlüssel verletzten den Primärschlüssel; die spätere Zeile gilt.
            zeilen.associateBy { it.schluessel }.values.mapIndexed { i, z -> BestandZeile(bereich, art.name, z.schluessel, i, z.inhalt) },
            stand)

    override suspend fun raeumeAndere(bereich: String) {
        dao.loescheAndereZeilen(bereich)
        dao.loescheAndereStaende(bereich)
    }

    override suspend fun leere() {
        dao.leereZeilen()
        dao.leereStaende()
    }
}

/**
 * [Ausgang] über Room. Ein Posten, der sich nicht mehr lesen lässt (Format einer
 * älteren App), wird beim Lesen entfernt — er blockierte sonst alles dahinter.
 */
class RoomAusgang @Inject constructor(private val db: BestandDatenbank) : Ausgang {
    private val dao get() = db.ausgang()

    override fun anzahl(bereich: String) = dao.anzahl(bereich)

    override suspend fun einreihen(bereich: String, bearbeitung: Bearbeitung, jetzt: Long) =
        dao.fuegeEin(AusgangZeile(bereich = bereich,
            bearbeitung = ApiJson.encodeToString(Bearbeitung.serializer(), bearbeitung), erstellt = jetzt))

    override suspend fun alle(bereich: String) = dao.alle(bereich).mapNotNull { lies(it) }

    override suspend fun erster(bereich: String): Ausgangsposten? {
        var z = dao.erster(bereich)
        while (z != null) {
            lies(z)?.let { return it }
            z = dao.erster(bereich)
        }
        return null
    }

    override suspend fun entferne(id: Long) = dao.entferne(id)
    override suspend fun versuchGescheitert(id: Long) = dao.versuchGescheitert(id)
    override suspend fun leere() = dao.leere()

    private suspend fun lies(z: AusgangZeile): Ausgangsposten? =
        runCatching { ApiJson.decodeFromString(Bearbeitung.serializer(), z.bearbeitung) }.getOrNull()
            ?.let { Ausgangsposten(z.id, it, z.erstellt, z.versuche) }
            ?: run { dao.entferne(z.id); null }
}
