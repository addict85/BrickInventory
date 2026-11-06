package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Offlineablage
import javax.inject.Inject

/** Was beim Abmelden von den Daten des Kontos verschwinden muss: Antwort-Cache, lokale Listen und Ausgang. */
fun interface KontoDatenLoescher {
    suspend fun loesche()
}

/**
 * Platte, lokale Listen und Ausgang gehören dem angemeldeten Konto. Was noch im
 * Ausgang wartet, geht dabei verloren — ein anderes Konto darf es nicht senden.
 */
internal class KontoDatenLoeschung @Inject constructor(
    private val cache: ResponseCache,
    private val ablage: Offlineablage,
) : KontoDatenLoescher {
    override suspend fun loesche() {
        cache.clear()
        ablage.leere()
    }
}
