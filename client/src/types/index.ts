export interface NavigationItem {
  href: string;
  label: string;
  icon: string;
  badge?: string | number;
}

export interface StatCard {
  label: string;
  value: string | number;
  change: string;
  icon: string;
  color: string;
  tooltip?: string;
  onClick?: () => void;
}

export interface CardFilters {
  setId?: number;
  search?: string;
  rarity?: string;
  isInsert?: boolean;
}

export interface TopSet {
  id: number;
  name: string;
  completion: string;
  value: string;
  change: string;
  image: string;
}
