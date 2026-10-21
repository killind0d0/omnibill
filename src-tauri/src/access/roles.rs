//! Roles and default permission matrix for OmniBill.

use serde::{Deserialize, Serialize};

use super::permissions::Permission;
use super::policy::is_role_valid_for_vertical;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Owner,
    CoOwner,
    Manager,
    Cashier,
    StockClerk,
    Accountant,
    Pharmacist,
    FrontDesk,
    LabTech,
    Bursar,
    Clerk,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::CoOwner => "co_owner",
            Role::Manager => "manager",
            Role::Cashier => "cashier",
            Role::StockClerk => "stock_clerk",
            Role::Accountant => "accountant",
            Role::Pharmacist => "pharmacist",
            Role::FrontDesk => "front_desk",
            Role::LabTech => "lab_tech",
            Role::Bursar => "bursar",
            Role::Clerk => "clerk",
        }
    }

    pub fn parse_role(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(Role::Owner),
            "co_owner" => Some(Role::CoOwner),
            "manager" => Some(Role::Manager),
            "cashier" => Some(Role::Cashier),
            "stock_clerk" => Some(Role::StockClerk),
            "accountant" => Some(Role::Accountant),
            "pharmacist" => Some(Role::Pharmacist),
            "front_desk" => Some(Role::FrontDesk),
            "lab_tech" => Some(Role::LabTech),
            "bursar" => Some(Role::Bursar),
            "clerk" => Some(Role::Clerk),
            _ => None,
        }
    }
}

impl std::str::FromStr for Role {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse_role(s).ok_or(())
    }
}

pub const ALL_PERMISSIONS: &[Permission] = &[
    Permission::SalesCreate,
    Permission::SalesHoldResume,
    Permission::SalesCancel,
    Permission::DiscountOverride,
    Permission::PriceOverride,
    Permission::PaymentsCollect,
    Permission::CreditLimitOverride,
    Permission::ProductsView,
    Permission::ProductsEdit,
    Permission::StockInward,
    Permission::StockAdjust,
    Permission::CustomersView,
    Permission::CustomersManage,
    Permission::ReportsBasic,
    Permission::ReportsFinancial,
    Permission::DiscoveryView,
    Permission::SellGraphView,
    Permission::AlertsView,
    Permission::DayClose,
    Permission::SettingsManage,
    Permission::UsersManage,
    Permission::AuditView,
    Permission::ExportData,
    Permission::BackupRestore,
    Permission::PrintReceipt,
    Permission::HospitalClinical,
    Permission::HospitalPharmacyDispense,
    Permission::HospitalLab,
    Permission::HospitalBilling,
    Permission::SchoolFeesCollect,
    Permission::SchoolStudentsManage,
    Permission::WholesaleCreditManage,
    Permission::WholesaleEway,
];

/// Returns the default permissions granted to a role in the given vertical.
/// If the role is invalid for the vertical, returns an empty set.
pub fn default_permissions(role: Role, vertical: &str) -> Vec<Permission> {
    if !is_role_valid_for_vertical(role.as_str(), vertical) {
        return Vec::new();
    }

    match role {
        Role::Owner | Role::CoOwner => ALL_PERMISSIONS
            .iter()
            .copied()
            .filter(|p| p.is_valid_for_vertical(vertical))
            .collect(),

        Role::Manager => ALL_PERMISSIONS
            .iter()
            .copied()
            .filter(|p| {
                p.is_valid_for_vertical(vertical)
                    && *p != Permission::UsersManage
                    && *p != Permission::SettingsManage
                    && *p != Permission::BackupRestore
            })
            .collect(),

        Role::Cashier => vec![
            Permission::SalesCreate,
            Permission::SalesHoldResume,
            Permission::PaymentsCollect,
            Permission::ProductsView,
            Permission::CustomersView,
            Permission::PrintReceipt,
        ],

        Role::StockClerk => vec![
            Permission::ProductsView,
            Permission::ProductsEdit,
            Permission::StockInward,
            Permission::StockAdjust,
        ],

        Role::Accountant => vec![
            Permission::ReportsBasic,
            Permission::ReportsFinancial,
            Permission::CustomersView,
            Permission::ExportData,
            Permission::AuditView,
        ],

        Role::Pharmacist => vec![
            Permission::HospitalPharmacyDispense,
            Permission::ProductsView,
            Permission::StockInward,
            Permission::PaymentsCollect,
            Permission::PrintReceipt,
        ],

        Role::FrontDesk => vec![
            Permission::HospitalBilling,
            Permission::CustomersView,
            Permission::CustomersManage,
            Permission::PaymentsCollect,
            Permission::PrintReceipt,
        ],

        Role::LabTech => vec![Permission::HospitalLab, Permission::CustomersView],

        Role::Bursar => vec![
            Permission::SchoolFeesCollect,
            Permission::ReportsBasic,
            Permission::PaymentsCollect,
            Permission::PrintReceipt,
            Permission::ExportData,
        ],

        Role::Clerk => vec![Permission::SchoolStudentsManage, Permission::CustomersView],
    }
}
