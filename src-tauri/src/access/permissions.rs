//! Permission catalog and vertical-specific validity classification.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    SalesCreate,
    SalesHoldResume,
    SalesCancel,
    DiscountOverride,
    PriceOverride,
    PaymentsCollect,
    CreditLimitOverride,
    ProductsView,
    ProductsEdit,
    StockInward,
    StockAdjust,
    CustomersView,
    CustomersManage,
    ReportsBasic,
    ReportsFinancial,
    DiscoveryView,
    SellGraphView,
    AlertsView,
    DayClose,
    SettingsManage,
    UsersManage,
    AuditView,
    ExportData,
    BackupRestore,
    PrintReceipt,
    HospitalClinical,
    HospitalPharmacyDispense,
    HospitalLab,
    HospitalBilling,
    SchoolFeesCollect,
    SchoolStudentsManage,
    WholesaleCreditManage,
    WholesaleEway,
}

impl Permission {
    /// Returns true if this permission is valid for the given vertical string.
    pub fn is_valid_for_vertical(&self, vertical: &str) -> bool {
        match self {
            Permission::HospitalClinical
            | Permission::HospitalPharmacyDispense
            | Permission::HospitalLab
            | Permission::HospitalBilling => vertical == "hospital",

            Permission::SchoolFeesCollect | Permission::SchoolStudentsManage => {
                vertical == "school"
            }

            Permission::WholesaleCreditManage | Permission::WholesaleEway => {
                vertical == "wholesale"
            }

            _ => true,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Permission::SalesCreate => "sales_create",
            Permission::SalesHoldResume => "sales_hold_resume",
            Permission::SalesCancel => "sales_cancel",
            Permission::DiscountOverride => "discount_override",
            Permission::PriceOverride => "price_override",
            Permission::PaymentsCollect => "payments_collect",
            Permission::CreditLimitOverride => "credit_limit_override",
            Permission::ProductsView => "products_view",
            Permission::ProductsEdit => "products_edit",
            Permission::StockInward => "stock_inward",
            Permission::StockAdjust => "stock_adjust",
            Permission::CustomersView => "customers_view",
            Permission::CustomersManage => "customers_manage",
            Permission::ReportsBasic => "reports_basic",
            Permission::ReportsFinancial => "reports_financial",
            Permission::DiscoveryView => "discovery_view",
            Permission::SellGraphView => "sell_graph_view",
            Permission::AlertsView => "alerts_view",
            Permission::DayClose => "day_close",
            Permission::SettingsManage => "settings_manage",
            Permission::UsersManage => "users_manage",
            Permission::AuditView => "audit_view",
            Permission::ExportData => "export_data",
            Permission::BackupRestore => "backup_restore",
            Permission::PrintReceipt => "print_receipt",
            Permission::HospitalClinical => "hospital_clinical",
            Permission::HospitalPharmacyDispense => "hospital_pharmacy_dispense",
            Permission::HospitalLab => "hospital_lab",
            Permission::HospitalBilling => "hospital_billing",
            Permission::SchoolFeesCollect => "school_fees_collect",
            Permission::SchoolStudentsManage => "school_students_manage",
            Permission::WholesaleCreditManage => "wholesale_credit_manage",
            Permission::WholesaleEway => "wholesale_eway",
        }
    }
}
