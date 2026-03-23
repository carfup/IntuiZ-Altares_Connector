import React from 'react';
import { 
  SearchRegular,
  CheckmarkCircleRegular,
  DismissCircleRegular,
  DatabaseRegular,
  EyeRegular,
  LinkRegular,
  ArrowSortUpRegular,
  ArrowSortDownRegular,
  ArrowSortRegular,
  AddRegular,
  QuestionCircleRegular,
  BuildingRegular,
  BuildingMultipleRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ChevronDoubleLeftRegular,
  ChevronDoubleRightRegular,
} from '@fluentui/react-icons';

// Exporting these as wrappers to maintain compatibility if props were used, 
// or simply re-exporting them. Given the previous file structure used classes, 
// we will just export the Fluent icons directly or wrapped to accept className if needed by old code,
// though standard Fluent usage prefers 'className' or 'style'.

export const SearchIcon = SearchRegular;
export const CheckCircleIcon = CheckmarkCircleRegular;
export const XCircleIcon = DismissCircleRegular;
export const DatabaseIcon = DatabaseRegular;
export const EyeIcon = EyeRegular;
export const LinkIcon = LinkRegular;
export const LoupeIcon = SearchRegular; // Reusing Search for Loupe
export const ChevronUpIcon = ArrowSortUpRegular;
export const ChevronDownIcon = ArrowSortDownRegular;
export const ChevronUpDownIcon = ArrowSortRegular;
export const PlusIcon = AddRegular;
export const QuestionMarkIcon = QuestionCircleRegular;
export const HeadquarterIcon = BuildingRegular;
export const BranchIcon = BuildingMultipleRegular;
export const ChevronLeftIcon = ChevronLeftRegular;
export const ChevronRightIcon = ChevronRightRegular;
export const ChevronDoubleLeftIcon = ChevronDoubleLeftRegular;
export const ChevronDoubleRightIcon = ChevronDoubleRightRegular;
