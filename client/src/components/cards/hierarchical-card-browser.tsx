import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Grid, List } from "lucide-react";
import { MainSetTile } from "./main-set-tile";
import { SubsetTile } from "./subset-tile";
import { CardGrid } from "./card-grid";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { CardSet } from "@shared/schema";

type ViewState = 'mainSets' | 'subsets' | 'cards';

interface HierarchicalCardBrowserProps {
  initialView?: ViewState;
  initialMainSetId?: number;
  initialSubsetId?: number;
}

export function HierarchicalCardBrowser({ 
  initialView = 'mainSets',
  initialMainSetId,
  initialSubsetId 
}: HierarchicalCardBrowserProps) {
  const [currentView, setCurrentView] = useState<ViewState>(initialView);
  const [selectedMainSet, setSelectedMainSet] = useState<CardSet | null>(null);
  const [selectedSubset, setSelectedSubset] = useState<CardSet | null>(null);
  const [mainSetId, setMainSetId] = useState<number | null>(initialMainSetId || null);
  const [subsetId, setSubsetId] = useState<number | null>(initialSubsetId || null);

  // Fetch main sets - only those marked as main sets
  const { data: allSets, isLoading: loadingMainSets } = useQuery({
    queryKey: ['/api/card-sets'],
  });

  // Filter to get only main sets
  const mainSets = allSets?.filter(set => set.isMainSet) || [];

  // Fetch subsets for selected main set
  const { data: subsets, isLoading: loadingSubsets } = useQuery({
    queryKey: ['/api/card-sets', mainSetId, 'subsets'],
    enabled: !!mainSetId && currentView === 'subsets',
  });

  const handleMainSetClick = (setId: number) => {
    const mainSet = mainSets?.find(set => set.id === setId);
    if (mainSet) {
      setSelectedMainSet(mainSet);
      setMainSetId(setId);
      setCurrentView('subsets');
    }
  };

  const handleSubsetClick = (setId: number) => {
    const subset = subsets?.find(set => set.id === setId);
    if (subset) {
      setSelectedSubset(subset);
      setSubsetId(setId);
      setCurrentView('cards');
    }
  };

  const handleBackToMainSets = () => {
    setCurrentView('mainSets');
    setSelectedMainSet(null);
    setMainSetId(null);
    setSelectedSubset(null);
    setSubsetId(null);
  };

  const handleBackToSubsets = () => {
    setCurrentView('subsets');
    setSelectedSubset(null);
    setSubsetId(null);
  };

  const renderBreadcrumb = () => {
    const breadcrumbItems = [];
    
    if (currentView === 'subsets' || currentView === 'cards') {
      breadcrumbItems.push(
        <Button
          key="back-to-main"
          variant="ghost"
          size="sm"
          onClick={handleBackToMainSets}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          All Sets
        </Button>
      );
      
      if (selectedMainSet) {
        breadcrumbItems.push(
          <span key="separator1" className="text-gray-400 mx-2">/</span>,
          <span key="main-set" className="text-gray-600 dark:text-gray-400 font-medium">
            {selectedMainSet.name}
          </span>
        );
      }
    }

    if (currentView === 'cards') {
      breadcrumbItems.push(
        <span key="separator2" className="text-gray-400 mx-2">/</span>,
        <Button
          key="back-to-subsets"
          variant="ghost"
          size="sm"
          onClick={handleBackToSubsets}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
        >
          Back to Subsets
        </Button>
      );
      
      if (selectedSubset) {
        breadcrumbItems.push(
          <span key="separator3" className="text-gray-400 mx-2">/</span>,
          <span key="subset" className="text-gray-600 dark:text-gray-400 font-medium">
            {selectedSubset.name}
          </span>
        );
      }
    }

    return (
      <div className="flex items-center mb-6 flex-wrap">
        {breadcrumbItems}
      </div>
    );
  };

  if (currentView === 'mainSets') {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Browse Card Sets</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {mainSets?.length || 0} main sets available
            </p>
          </div>
        </div>

        {loadingMainSets ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {mainSets?.map((mainSet) => (
              <MainSetTile
                key={mainSet.id}
                mainSet={mainSet}
                onSetClick={handleMainSetClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (currentView === 'subsets') {
    return (
      <div className="container mx-auto px-4 py-6">
        {renderBreadcrumb()}
        
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {selectedMainSet?.name} Subsets
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {subsets?.length || 0} variants available
            </p>
          </div>
        </div>

        {loadingSubsets ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {subsets?.map((subset) => (
              <SubsetTile
                key={subset.id}
                subset={subset}
                onSubsetClick={handleSubsetClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (currentView === 'cards') {
    return (
      <div className="container mx-auto px-4 py-6">
        {renderBreadcrumb()}
        
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {selectedSubset?.name} Cards
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              {selectedSubset?.totalCards || 0} cards in this subset
            </p>
          </div>
        </div>

        <CardGrid setId={subsetId} />
      </div>
    );
  }

  return null;
}