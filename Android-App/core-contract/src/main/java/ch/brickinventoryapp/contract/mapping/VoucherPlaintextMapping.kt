package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.GutscheinKlartext
import ch.brickinventoryapp.model.domain.PlaintextView

fun GutscheinKlartext.asView() = PlaintextView(id, number, pin)
