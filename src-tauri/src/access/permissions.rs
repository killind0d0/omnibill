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

    pub fn parse_permission(s: &str) -> Option<Self> {
        match s {
            "sales_create" => Some(Permission::SalesCreate),
            "sales_hold_resume" => Some(Permission::SalesHoldResume),
            "sales_cancel" => Some(Permission::SalesCancel),
            "discount_override" => Some(Permission::DiscountOverride),
            "price_override" => Some(Permission::PriceOverride),
            "payments_collect" => Some(Permission::PaymentsCollect),
            "credit_limit_override" => Some(Permission::CreditLimitOverride),
            "products_view" => Some(Permission::ProductsView),
            "products_edit" => Some(Permission::ProductsEdit),
            "stock_inward" => Some(Permission::StockInward),
            "stock_adjust" => Some(Permission::StockAdjust),
            "customers_view" => Some(Permission::CustomersView),
            "customers_manage" => Some(Permission::CustomersManage),
            "reports_basic" => Some(Permission::ReportsBasic),
            "reports_financial" => Some(Permission::ReportsFinancial),
            "discovery_view" => Some(Permission::DiscoveryView),
            "sell_graph_view" => Some(Permission::SellGraphView),
            "alerts_view" => Some(Permission::AlertsView),
            "day_close" => Some(Permission::DayClose),
            "settings_manage" => Some(Permission::SettingsManage),
            "users_manage" => Some(Permission::UsersManage),
            "audit_view" => Some(Permission::AuditView),
            "export_data" => Some(Permission::ExportData),
            "backup_restore" => Some(Permission::BackupRestore),
            "print_receipt" => Some(Permission::PrintReceipt),
            "hospital_clinical" => Some(Permission::HospitalClinical),
            "hospital_pharmacy_dispense" => Some(Permission::HospitalPharmacyDispense),
            "hospital_lab" => Some(Permission::HospitalLab),
            "hospital_billing" => Some(Permission::HospitalBilling),
            "school_fees_collect" => Some(Permission::SchoolFeesCollect),
            "school_students_manage" => Some(Permission::SchoolStudentsManage),
            "wholesale_credit_manage" => Some(Permission::WholesaleCreditManage),
            "wholesale_eway" => Some(Permission::WholesaleEway),
            _ => None,
        }
    }
}

impl std::str::FromStr for Permission {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse_permission(s).ok_or(())
    }
}
