package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.GutscheinKlartext
import ch.brickinventoryapp.model.fach.KlartextAnsicht

fun GutscheinKlartext.alsAnsicht() = KlartextAnsicht(id, number, pin)
