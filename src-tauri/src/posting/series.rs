use super::PostingError;
use rusqlite::params;

/// Derives the Indian Financial Year string from an invoice date `YYYY-MM-DD`.
///
/// In the Indian tax system:
/// - April 1 to March 31 of the next calendar year forms a single Financial Year.
/// - E.g., `2026-04-01` and `2027-03-31` both belong to `2026-27`.
/// - `2027-04-01` starts `2027-28`.
pub fn parse_financial_year(invoice_date: &str) -> Result<String, PostingError> {
    if invoice_date.len() != 10 {
        return Err(PostingError::InvalidDateFormat(invoice_date.to_string()));
    }
    let parts: Vec<&str> = invoice_date.split('-').collect();
    if parts.len() != 3 {
        return Err(PostingError::InvalidDateFormat(invoice_date.to_string()));
    }

    let year: i32 = parts[0]
        .parse()
        .map_err(|_| PostingError::InvalidDateFormat(invoice_date.to_string()))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| PostingError::InvalidDateFormat(invoice_date.to_string()))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| PostingError::InvalidDateFormat(invoice_date.to_string()))?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || !(1000..=9999).contains(&year) {
        return Err(PostingError::InvalidDateFormat(invoice_date.to_string()));
    }

    let start_year = if month >= 4 { year } else { year - 1 };
    let end_year = start_year + 1;
    let end_suffix = end_year.rem_euclid(100);

    Ok(format!("{}-{:02}", start_year, end_suffix))
}

/// Allocates the next gapless invoice number from `number_series` inside an active transaction.
///
/// # Invoice Number Format:
/// The invoice number is constructed as `{prefix}{zero_padded_number}` where:
/// - `prefix` is the series prefix from `number_series` (e.g., `"INV/26-27/"`).
/// - `zero_padded_number` is `next_number` formatted with zero padding up to `padding` digits (e.g., `"0001"`).
/// - The complete invoice number must not exceed 16 characters (GST limit and schema CHECK).
///
/// If no active series row exists for this `(series_code, financial_year)` combination,
/// a standard default row is initialized starting at `next_number = 1`.
/// The row is updated using `next_number = next_number + 1` to strictly satisfy the
/// `trg_number_series_update_guard` trigger.
pub fn allocate_invoice_number(
    tx: &rusqlite::Transaction<'_>,
    series_code: &str,
    invoice_date: &str,
) -> Result<(String, String), PostingError> {
    let fy = parse_financial_year(invoice_date)?;

    let series_query = tx.query_row(
        "SELECT id, prefix, next_number, padding
         FROM number_series
         WHERE series_code = ?1 AND financial_year = ?2 AND is_active = 1",
        params![series_code, &fy],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        },
    );

    let (series_id, prefix, next_num, padding) = match series_query {
        Ok(found) => found,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Auto-seed default series for this FY if not yet configured
            let short_fy = if fy.len() >= 5 {
                &fy[2..]
            } else {
                &fy
            };
            let prefix = format!("{}/{}/", series_code, short_fy);
            let gen_id = format!("ns_{}_{}", series_code.to_lowercase(), short_fy.replace('-', "_"));
            let next_num = 1i64;
            let padding = 4i64;

            tx.execute(
                "INSERT INTO number_series (
                    id, series_code, financial_year, prefix, next_number, padding, is_active
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                params![&gen_id, series_code, &fy, &prefix, next_num, padding],
            )?;

            (gen_id, prefix, next_num, padding)
        }
        Err(err) => return Err(PostingError::Database(err)),
    };

    let number_str = format!("{:0width$}", next_num, width = padding as usize);
    let invoice_number = format!("{}{}", prefix, number_str);

    if invoice_number.len() > 16 {
        return Err(PostingError::InvoiceNumberExceedsLimit(invoice_number));
    }

    // Increment next_number by exactly 1 to satisfy trg_number_series_update_guard
    tx.execute(
        "UPDATE number_series SET next_number = next_number + 1 WHERE id = ?1",
        params![&series_id],
    )?;

    Ok((series_code.to_string(), invoice_number))
}
