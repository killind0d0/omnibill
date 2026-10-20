use super::{LineInput, PostingError, PriceMode, SaleInput};

/// Divides `numerator` by `denominator` using round-half-up (half away from zero).
///
/// For positive numbers: `(numerator + denominator / 2) / denominator`.
/// For negative numbers: `(numerator - denominator / 2) / denominator`.
/// Uses `i128` intermediates with checked arithmetic to guarantee no wraps or panics.
pub fn round_div_i128(numerator: i128, denominator: i128) -> Result<i128, PostingError> {
    if denominator == 0 {
        return Err(PostingError::DivisionByZero);
    }
    if numerator == 0 {
        return Ok(0);
    }

    let (num, den) = if denominator < 0 {
        let n = numerator.checked_neg().ok_or(PostingError::MathOverflow)?;
        let d = denominator
            .checked_neg()
            .ok_or(PostingError::MathOverflow)?;
        (n, d)
    } else {
        (numerator, denominator)
    };

    let half = den / 2;
    let rounded_num = if num >= 0 {
        num.checked_add(half).ok_or(PostingError::MathOverflow)?
    } else {
        num.checked_sub(half).ok_or(PostingError::MathOverflow)?
    };

    Ok(rounded_num / den)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputedLine {
    pub resource_id: String,
    pub quantity_milli: i64,
    pub unit_price_paise: i64,
    pub gross_paise: i64,
    pub discount_paise: i64,
    pub taxable_paise: i64,
    pub tax_rate_bps: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub line_total_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputedDocumentTotals {
    pub subtotal_paise: i64,
    pub discount_paise: i64,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub round_off_paise: i64,
    pub total_amount_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaxComputation {
    pub lines: Vec<ComputedLine>,
    pub totals: ComputedDocumentTotals,
}

/// Computes all line amounts according to price mode and state codes.
pub fn compute_line(
    line: &LineInput,
    price_mode: PriceMode,
    is_intra_state: bool,
) -> Result<ComputedLine, PostingError> {
    if line.quantity_milli <= 0 {
        return Err(PostingError::InvalidQuantity(line.quantity_milli));
    }
    if line.unit_price_paise < 0 {
        return Err(PostingError::InvalidUnitPrice(line.unit_price_paise));
    }
    if line.tax_rate_bps < 0 || line.tax_rate_bps > 10000 {
        return Err(PostingError::InvalidTaxRate(line.tax_rate_bps));
    }

    // gross = round(quantity_milli * unit_price_paise / 1000)
    let q_i128 = line.quantity_milli as i128;
    let p_i128 = line.unit_price_paise as i128;
    let mult = q_i128
        .checked_mul(p_i128)
        .ok_or(PostingError::MathOverflow)?;
    let gross_i128 = round_div_i128(mult, 1000)?;
    let gross_paise = i64::try_from(gross_i128).map_err(|_| PostingError::MathOverflow)?;

    if line.discount_paise < 0 || line.discount_paise > gross_paise {
        return Err(PostingError::InvalidDiscount {
            discount_paise: line.discount_paise,
            gross_paise,
        });
    }

    let discount_paise = line.discount_paise;
    let rate_bps = line.tax_rate_bps;

    let (taxable_paise, cgst_paise, sgst_paise, igst_paise, line_total_paise) = match price_mode {
        PriceMode::Exclusive => {
            let taxable_paise = gross_paise
                .checked_sub(discount_paise)
                .ok_or(PostingError::MathOverflow)?;
            let t_i128 = taxable_paise as i128;
            let r_i128 = rate_bps as i128;

            let (cgst, sgst, igst) = if is_intra_state {
                let num = t_i128
                    .checked_mul(r_i128)
                    .ok_or(PostingError::MathOverflow)?;
                let c_i128 = round_div_i128(num, 20000)?;
                let c = i64::try_from(c_i128).map_err(|_| PostingError::MathOverflow)?;
                (c, c, 0)
            } else {
                let num = t_i128
                    .checked_mul(r_i128)
                    .ok_or(PostingError::MathOverflow)?;
                let i_i128 = round_div_i128(num, 10000)?;
                let i = i64::try_from(i_i128).map_err(|_| PostingError::MathOverflow)?;
                (0, 0, i)
            };

            let line_total = taxable_paise
                .checked_add(cgst)
                .and_then(|x| x.checked_add(sgst))
                .and_then(|x| x.checked_add(igst))
                .ok_or(PostingError::MathOverflow)?;

            (taxable_paise, cgst, sgst, igst, line_total)
        }
        PriceMode::Inclusive => {
            let line_base = gross_paise
                .checked_sub(discount_paise)
                .ok_or(PostingError::MathOverflow)?;
            let b_i128 = line_base as i128;
            let denom = 10000i128
                .checked_add(rate_bps as i128)
                .ok_or(PostingError::MathOverflow)?;
            let num = b_i128
                .checked_mul(10000)
                .ok_or(PostingError::MathOverflow)?;
            let taxable_i128 = round_div_i128(num, denom)?;
            let taxable_paise =
                i64::try_from(taxable_i128).map_err(|_| PostingError::MathOverflow)?;

            let t_i128 = taxable_paise as i128;
            let r_i128 = rate_bps as i128;

            let (cgst, sgst, igst) = if is_intra_state {
                let num = t_i128
                    .checked_mul(r_i128)
                    .ok_or(PostingError::MathOverflow)?;
                let c_i128 = round_div_i128(num, 20000)?;
                let c = i64::try_from(c_i128).map_err(|_| PostingError::MathOverflow)?;
                (c, c, 0)
            } else {
                let num = t_i128
                    .checked_mul(r_i128)
                    .ok_or(PostingError::MathOverflow)?;
                let i_i128 = round_div_i128(num, 10000)?;
                let i = i64::try_from(i_i128).map_err(|_| PostingError::MathOverflow)?;
                (0, 0, i)
            };

            let line_total = taxable_paise
                .checked_add(cgst)
                .and_then(|x| x.checked_add(sgst))
                .and_then(|x| x.checked_add(igst))
                .ok_or(PostingError::MathOverflow)?;

            (taxable_paise, cgst, sgst, igst, line_total)
        }
    };

    Ok(ComputedLine {
        resource_id: line.resource_id.clone(),
        quantity_milli: line.quantity_milli,
        unit_price_paise: line.unit_price_paise,
        gross_paise,
        discount_paise,
        taxable_paise,
        tax_rate_bps: line.tax_rate_bps,
        cgst_paise,
        sgst_paise,
        igst_paise,
        line_total_paise,
    })
}

/// Computes line amounts and document totals for a complete sale.
pub fn compute_sale(input: &SaleInput) -> Result<TaxComputation, PostingError> {
    if input.lines.is_empty() {
        return Err(PostingError::EmptyLines);
    }

    let is_intra_state = input.seller_state_code == input.place_of_supply_state_code;
    let mut computed_lines = Vec::with_capacity(input.lines.len());

    let mut sum_subtotal: i64 = 0;
    let mut sum_discount: i64 = 0;
    let mut sum_taxable: i64 = 0;
    let mut sum_cgst: i64 = 0;
    let mut sum_sgst: i64 = 0;
    let mut sum_igst: i64 = 0;

    for line in &input.lines {
        let computed = compute_line(line, input.price_mode, is_intra_state)?;
        let line_subtotal = computed
            .taxable_paise
            .checked_add(computed.discount_paise)
            .ok_or(PostingError::MathOverflow)?;

        sum_subtotal = sum_subtotal
            .checked_add(line_subtotal)
            .ok_or(PostingError::MathOverflow)?;
        sum_discount = sum_discount
            .checked_add(computed.discount_paise)
            .ok_or(PostingError::MathOverflow)?;
        sum_taxable = sum_taxable
            .checked_add(computed.taxable_paise)
            .ok_or(PostingError::MathOverflow)?;
        sum_cgst = sum_cgst
            .checked_add(computed.cgst_paise)
            .ok_or(PostingError::MathOverflow)?;
        sum_sgst = sum_sgst
            .checked_add(computed.sgst_paise)
            .ok_or(PostingError::MathOverflow)?;
        sum_igst = sum_igst
            .checked_add(computed.igst_paise)
            .ok_or(PostingError::MathOverflow)?;

        computed_lines.push(computed);
    }

    let total_before = sum_taxable
        .checked_add(sum_cgst)
        .and_then(|x| x.checked_add(sum_sgst))
        .and_then(|x| x.checked_add(sum_igst))
        .ok_or(PostingError::MathOverflow)?;

    // Round-off to the nearest rupee (100 paise), .50 rounds up
    let rounded_rupees = round_div_i128(total_before as i128, 100)?;
    let rounded_paise_i128 = rounded_rupees
        .checked_mul(100)
        .ok_or(PostingError::MathOverflow)?;
    let rounded_paise =
        i64::try_from(rounded_paise_i128).map_err(|_| PostingError::MathOverflow)?;

    let round_off_paise = rounded_paise
        .checked_sub(total_before)
        .ok_or(PostingError::MathOverflow)?;

    if !(-99..=99).contains(&round_off_paise) {
        return Err(PostingError::MathOverflow);
    }

    let total_amount_paise = rounded_paise;

    Ok(TaxComputation {
        lines: computed_lines,
        totals: ComputedDocumentTotals {
            subtotal_paise: sum_subtotal,
            discount_paise: sum_discount,
            taxable_paise: sum_taxable,
            cgst_paise: sum_cgst,
            sgst_paise: sum_sgst,
            igst_paise: sum_igst,
            round_off_paise,
            total_amount_paise,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test 1 protects: Intra-state standard calculation rule (18% split equally into 9% CGST and 9% SGST).
    #[test]
    fn test_1_intra_state_single_line_exclusive() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = compute_sale(&input).expect("Valid sale computation must succeed");
        assert_eq!(res.totals.taxable_paise, 10000);
        assert_eq!(res.totals.cgst_paise, 900);
        assert_eq!(res.totals.sgst_paise, 900);
        assert_eq!(res.totals.igst_paise, 0);
        assert_eq!(res.totals.round_off_paise, 0);
        assert_eq!(res.totals.total_amount_paise, 11800);
    }

    // Test 2 protects: Inter-state tax rule (18% full tax to IGST; zero CGST and zero SGST).
    #[test]
    fn test_2_inter_state_single_line_exclusive() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "29".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = compute_sale(&input).expect("Valid inter-state computation must succeed");
        assert_eq!(res.totals.taxable_paise, 10000);
        assert_eq!(res.totals.cgst_paise, 0);
        assert_eq!(res.totals.sgst_paise, 0);
        assert_eq!(res.totals.igst_paise, 1800);
        assert_eq!(res.totals.round_off_paise, 0);
        assert_eq!(res.totals.total_amount_paise, 11800);
    }

    // Test 3 protects: Fractional gross price and round-off rule (gross 9999, round_off +1).
    #[test]
    fn test_3_fractional_gross_with_round_off() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 3000,
                unit_price_paise: 3333,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = compute_sale(&input).expect("Computation must succeed");
        assert_eq!(res.lines[0].gross_paise, 9999);
        assert_eq!(res.totals.taxable_paise, 9999);
        assert_eq!(res.totals.cgst_paise, 900);
        assert_eq!(res.totals.sgst_paise, 900);
        assert_eq!(res.totals.round_off_paise, 1);
        assert_eq!(res.totals.total_amount_paise, 11800);
    }

    // Test 4 protects: Round-half-up division rule for milli-quantity gross calculation.
    #[test]
    fn test_4_fractional_quantity_round_half_up() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1500,
                unit_price_paise: 2999,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let res = compute_sale(&input).expect("Computation must succeed");
        assert_eq!(res.lines[0].gross_paise, 4499);
    }

    // Test 5 protects: Tax inclusive price extraction formula (taxable = line_total * 10000 / (10000 + rate)).
    #[test]
    fn test_5_tax_inclusive_mode() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Inclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 11800,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = compute_sale(&input).expect("Computation must succeed");
        assert_eq!(res.totals.taxable_paise, 10000);
        assert_eq!(res.totals.cgst_paise, 900);
        assert_eq!(res.totals.sgst_paise, 900);
        assert_eq!(res.lines[0].line_total_paise, 11800);
        assert_eq!(res.totals.total_amount_paise, 11800);
    }

    // Test 6 protects: 0% tax rate handling (tax is zero and no spurious tax ledger rows).
    #[test]
    fn test_6_zero_tax_rate() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 5000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let res = compute_sale(&input).expect("Computation must succeed");
        assert_eq!(res.totals.taxable_paise, 5000);
        assert_eq!(res.totals.cgst_paise, 0);
        assert_eq!(res.totals.sgst_paise, 0);
        assert_eq!(res.totals.igst_paise, 0);
        assert_eq!(res.totals.total_amount_paise, 5000);
    }

    // Test 7 protects: Line discount calculation rule (taxable = gross - discount).
    #[test]
    fn test_7_line_discount_exclusive() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 1000,
                tax_rate_bps: 0,
            }],
        };

        let res = compute_sale(&input).expect("Computation must succeed");
        assert_eq!(res.totals.subtotal_paise, 10000);
        assert_eq!(res.totals.discount_paise, 1000);
        assert_eq!(res.totals.taxable_paise, 9000);
        assert_eq!(res.totals.total_amount_paise, 9000);
    }

    // Test 8 protects: Half-way round off boundary rule (.50 rounds UP to next rupee).
    #[test]
    fn test_8_round_off_exact_half_rounds_up() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 1050,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let res = compute_sale(&input).expect("Computation must succeed");
        assert_eq!(res.totals.taxable_paise, 1050);
        assert_eq!(res.totals.round_off_paise, 50);
        assert_eq!(res.totals.total_amount_paise, 1100);
    }

    // Test 9 protects: Arithmetic overflow safety (i128 checked arithmetic, returns error without panic).
    #[test]
    fn test_9_overflow_returns_typed_error() {
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: i64::MAX,
                unit_price_paise: i64::MAX,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = compute_sale(&input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::MathOverflow => {}
            other => panic!("Expected MathOverflow error, got {:?}", other),
        }
    }

    // Test 10 protects: Input validation invariants (empty lines, non-positive quantity, negative price, discount > gross, invalid tax rate).
    #[test]
    fn test_10_input_validation_rules() {
        // (a) Empty lines
        let empty_input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![],
        };
        assert!(matches!(
            compute_sale(&empty_input).unwrap_err(),
            PostingError::EmptyLines
        ));

        // (b) Quantity 0
        let zero_qty = SaleInput {
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 0,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
            ..empty_input.clone()
        };
        assert!(matches!(
            compute_sale(&zero_qty).unwrap_err(),
            PostingError::InvalidQuantity(0)
        ));

        // (c) Negative price
        let neg_price = SaleInput {
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: -100,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
            ..empty_input.clone()
        };
        assert!(matches!(
            compute_sale(&neg_price).unwrap_err(),
            PostingError::InvalidUnitPrice(-100)
        ));

        // (d) Discount > Gross
        let big_discount = SaleInput {
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 2000,
                tax_rate_bps: 1800,
            }],
            ..empty_input.clone()
        };
        assert!(matches!(
            compute_sale(&big_discount).unwrap_err(),
            PostingError::InvalidDiscount {
                discount_paise: 2000,
                gross_paise: 1000
            }
        ));

        // (e) Tax rate > 10000 bps
        let big_rate = SaleInput {
            lines: vec![LineInput {
                resource_id: "res_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 10001,
            }],
            ..empty_input
        };
        assert!(matches!(
            compute_sale(&big_rate).unwrap_err(),
            PostingError::InvalidTaxRate(10001)
        ));
    }

    // Test 11 protects: 0.25% (25 bps) odd basis points GST rate without integer truncation.
    #[test]
    fn test_11_odd_basis_points_quarter_percent_tax() {
        let line = LineInput {
            resource_id: "res_diamond".to_string(),
            quantity_milli: 10000, // 10 units
            unit_price_paise: 200000, // ₹2,000.00 each
            discount_paise: 0,
            tax_rate_bps: 25, // 0.25% GST rate (precious stones/rough diamonds)
        };

        // Intra-state supply: CGST (0.125%) and SGST (0.125%)
        let comp = compute_line(&line, PriceMode::Exclusive, true).unwrap();
        assert_eq!(comp.taxable_paise, 2000000); // ₹20,000.00
        assert_eq!(comp.cgst_paise, 2500); // ₹25.00 (exact, zero truncation of 25 bps!)
        assert_eq!(comp.sgst_paise, 2500); // ₹25.00
        assert_eq!(comp.igst_paise, 0);
        assert_eq!(comp.line_total_paise, 2005000); // ₹20,050.00

        // Inter-state supply: IGST 0.25%
        let comp_inter = compute_line(&line, PriceMode::Exclusive, false).unwrap();
        assert_eq!(comp_inter.taxable_paise, 2000000);
        assert_eq!(comp_inter.cgst_paise, 0);
        assert_eq!(comp_inter.sgst_paise, 0);
        assert_eq!(comp_inter.igst_paise, 5000); // ₹50.00
        assert_eq!(comp_inter.line_total_paise, 2005000);
    }

    // Test 12 protects: Inclusive pricing property (taxable + tax within 1 paisa of MRP base).
    #[test]
    fn test_12_tax_inclusive_mrp_back_calculation_property() {
        let test_prices = [1000, 29900, 49900, 99900, 150000]; // ₹10, ₹299, ₹499, ₹999, ₹1,500
        let test_rates = [0, 25, 500, 1200, 1800, 2800];

        for &price in &test_prices {
            for &rate in &test_rates {
                let line = LineInput {
                    resource_id: "res_item".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: price,
                    discount_paise: 0,
                    tax_rate_bps: rate,
                };

                let comp = compute_line(&line, PriceMode::Inclusive, true).unwrap();
                let sum_tax = comp.cgst_paise + comp.sgst_paise;
                let calculated_total = comp.taxable_paise + sum_tax;
                let diff = (calculated_total - price).abs();
                assert!(
                    diff <= 1,
                    "Inclusive taxable + tax must be within 1 paisa of MRP {} (got taxable={}, tax={}, rate={})",
                    price, comp.taxable_paise, sum_tax, rate
                );
            }
        }
    }
}
