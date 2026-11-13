package ch.brickinventoryapp.ui.util

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Wann ein kopiertes Geheimnis aus der Zwischenablage verschwindet: nach Ablauf,
 * nur unser eigener Clip, und nie blind, wenn die Ablage nicht lesbar ist.
 *
 * Gegenproben:
 *   A  `!lesbar` aus der WARTEN-Bedingung entfernt → rot „im Hintergrund …“
 *      (VERGESSEN statt WARTEN: Das Geheimnis bliebe für immer liegen)
 *   B  der Vergleich `kennungImClip == kennung` durch `true` ersetzt → rot
 *      „fremder Inhalt wird nicht geleert“
 */
class GeheimAblaufTest {

    @Test
    fun `vor Ablauf wird gewartet, danach der eigene Clip geleert`() {
        assertEquals(GeheimSchritt.WARTEN, geheimSchritt("k1", 1000, 999, lesbar = true, kennungImClip = "k1"))
        assertEquals(GeheimSchritt.LEEREN, geheimSchritt("k1", 1000, 1000, lesbar = true, kennungImClip = "k1"))
    }

    @Test
    fun `fremder Inhalt wird nicht geleert`() {
        assertEquals(GeheimSchritt.VERGESSEN, geheimSchritt("k1", 1000, 2000, lesbar = true, kennungImClip = null))
        assertEquals(GeheimSchritt.VERGESSEN, geheimSchritt("k1", 1000, 2000, lesbar = true, kennungImClip = "k2"))
    }

    @Test
    fun `im Hintergrund wird gewartet, bis die Ablage lesbar ist`() {
        assertEquals(GeheimSchritt.WARTEN, geheimSchritt("k1", 1000, 2000, lesbar = false, kennungImClip = null))
    }

    @Test
    fun `ohne offenes Geheimnis gibt es nichts zu tun`() {
        assertEquals(GeheimSchritt.VERGESSEN, geheimSchritt(null, 0, 2000, lesbar = true, kennungImClip = "k1"))
    }
}
