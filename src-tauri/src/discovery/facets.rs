use crate::discovery::query::{build_base_where, DiscoveryQuery, QueryError, WhereFilterOptions};
use rusqlite::{Connection, ToSql};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetItem {
    pub id: String,
    pub label: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub brands: Vec<FacetItem>,
    pub suppliers: Vec<FacetItem>,
    pub categories: Vec<FacetItem>,
    pub tax_bp: Vec<FacetItem>,
}

/// Computes facet counts for brands, suppliers, categories, and tax rates.
/// Each facet query applies every filter in `q` EXCEPT its own filter.
pub fn discover_facets(
    conn: &Connection,
    vertical: &str,
    today: i64,
    q: &DiscoveryQuery,
) -> Result<Facets, QueryError> {
    // 1. Brands facet (all filters except brand_ids)
    let brands = {
        let (clauses, params) = build_base_where(
            conn,
            vertical,
            today,
            q,
            WhereFilterOptions {
                skip_brand: true,
                ..Default::default()
            },
        )?;
        let sql = format!(
            "SELECT
                COALESCE(b.id, 0) AS f_id,
                COALESCE(b.name, 'Unbranded') AS f_label,
                COUNT(*) AS f_count
             FROM product_stats s
             JOIN resources r ON r.id = s.resource_id
             LEFT JOIN brands b ON b.id = s.brand_id
             WHERE {}
             GROUP BY s.brand_id, b.name
             ORDER BY f_count DESC, f_label ASC
             LIMIT 50",
            clauses.join(" AND ")
        );
        let rusqlite_params: Vec<&dyn ToSql> = params.iter().map(|p| p as &dyn ToSql).collect();
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite_params.as_slice())?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let label: String = row.get(1)?;
            let count: i64 = row.get(2)?;
            items.push(FacetItem {
                id: id.to_string(),
                label,
                count: count as u64,
            });
        }
        items
    };

    // 2. Suppliers facet (all filters except supplier_ids)
    let suppliers = {
        let (clauses, params) = build_base_where(
            conn,
            vertical,
            today,
            q,
            WhereFilterOptions {
                skip_supplier: true,
                ..Default::default()
            },
        )?;
        let sql = format!(
            "SELECT
                COALESCE(l.supplier_id, 'none') AS f_id,
                COALESCE(e.full_name, 'Unknown') AS f_label,
                COUNT(DISTINCT s.resource_id) AS f_count
             FROM product_stats s
             JOIN resources r ON r.id = s.resource_id
             JOIN resource_lots l ON l.resource_id = s.resource_id
             LEFT JOIN entities e ON e.id = l.supplier_id
             WHERE {}
             GROUP BY l.supplier_id, e.full_name
             ORDER BY f_count DESC, f_label ASC
             LIMIT 50",
            clauses.join(" AND ")
        );
        let rusqlite_params: Vec<&dyn ToSql> = params.iter().map(|p| p as &dyn ToSql).collect();
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite_params.as_slice())?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let label: String = row.get(1)?;
            let count: i64 = row.get(2)?;
            items.push(FacetItem {
                id,
                label,
                count: count as u64,
            });
        }
        items
    };

    // 3. Categories facet (all filters except category_ids)
    let categories = {
        let (clauses, params) = build_base_where(
            conn,
            vertical,
            today,
            q,
            WhereFilterOptions {
                skip_category: true,
                ..Default::default()
            },
        )?;
        let sql = format!(
            "SELECT
                COALESCE(s.category_id, 0) AS f_id,
                CAST(COALESCE(s.category_id, 0) AS TEXT) AS f_label,
                COUNT(*) AS f_count
             FROM product_stats s
             JOIN resources r ON r.id = s.resource_id
             WHERE {}
             GROUP BY s.category_id
             ORDER BY f_count DESC
             LIMIT 50",
            clauses.join(" AND ")
        );
        let rusqlite_params: Vec<&dyn ToSql> = params.iter().map(|p| p as &dyn ToSql).collect();
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite_params.as_slice())?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let label: String = row.get(1)?;
            let count: i64 = row.get(2)?;
            items.push(FacetItem {
                id: id.to_string(),
                label,
                count: count as u64,
            });
        }
        items
    };

    // 4. Tax rates facet (all filters except tax_bp)
    let tax_bp = {
        let (clauses, params) = build_base_where(
            conn,
            vertical,
            today,
            q,
            WhereFilterOptions {
                skip_tax: true,
                ..Default::default()
            },
        )?;
        let sql = format!(
            "SELECT
                s.tax_bp AS f_id,
                CAST(s.tax_bp AS TEXT) AS f_label,
                COUNT(*) AS f_count
             FROM product_stats s
             JOIN resources r ON r.id = s.resource_id
             WHERE {}
             GROUP BY s.tax_bp
             ORDER BY f_count DESC
             LIMIT 50",
            clauses.join(" AND ")
        );
        let rusqlite_params: Vec<&dyn ToSql> = params.iter().map(|p| p as &dyn ToSql).collect();
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite_params.as_slice())?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let label: String = row.get(1)?;
            let count: i64 = row.get(2)?;
            items.push(FacetItem {
                id: id.to_string(),
                label,
                count: count as u64,
            });
        }
        items
    };

    Ok(Facets {
        brands,
        suppliers,
        categories,
        tax_bp,
    })
}
