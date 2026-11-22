package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.GutscheinKlartext
import ch.brickinventoryapp.model.domain.PlaintextView

fun GutscheinKlartext.alsAnsicht() = PlaintextView(id, number, pin)
