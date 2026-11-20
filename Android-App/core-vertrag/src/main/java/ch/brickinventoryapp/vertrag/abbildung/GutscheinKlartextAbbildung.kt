package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.GutscheinKlartext
import ch.brickinventoryapp.model.fach.PlaintextView

fun GutscheinKlartext.alsAnsicht() = PlaintextView(id, number, pin)
