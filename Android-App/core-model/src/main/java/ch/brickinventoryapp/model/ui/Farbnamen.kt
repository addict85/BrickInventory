package ch.brickinventoryapp.model.ui

import ch.brickinventoryapp.model.ui.model.FarbeAnsicht
import ch.brickinventoryapp.model.ui.model.OHNE_FARBE

/**
 * Die Farbliste ohne ihren Eintrag für KEINE_FARBE („[No Color/Any Color]“):
 * Die Auswahl führt „keine Farbe“ selbst, in der Sprache der App; sonst stünde
 * dieselbe Wahl zweimal da.
 */
fun ohneKeineFarbe(farben: List<FarbeAnsicht>) =
    farben.filter { it.id != OHNE_FARBE }

/**
 * Der Name der heutigen Farbe: KEINE_FARBE heisst [keineFarbe], nie „Farbe
 * 9999“; sonst der Name aus der Liste, dann der gespeicherte. Null, wenn
 * keiner bekannt ist — dann nennt die Anzeige die Nummer.
 */
fun farbName(farben: List<FarbeAnsicht>, aktuell: Int,
             aktuellerName: String?, keineFarbe: String): String? =
    if (aktuell == OHNE_FARBE) keineFarbe
    else farben.firstOrNull { it.id == aktuell }?.name ?: aktuellerName?.takeIf { it.isNotBlank() }
