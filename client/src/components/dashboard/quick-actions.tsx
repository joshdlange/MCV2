import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Camera, Plus } from "lucide-react";
import { TopSet } from "@/types";

const topSets: TopSet[] = [
  {
    id: 1,
    name: "Marvel Universe 2023",
    completion: "78/100 cards (78%)",
    value: "$1,247",
    change: "+$89",
    image: "https://images.unsplash.com/photo-1601645191163-3fc0d5d64e35?ixlib=rb-4.0.3&auto=format&fit=crop&w=40&h=40"
  },
  {
    id: 2,
    name: "Marvel Heroes 2023", 
    completion: "45/75 cards (60%)",
    value: "$892",
    change: "+$56",
    image: "https://images.unsplash.com/photo-1612198188060-c7c2a3b66eae?ixlib=rb-4.0.3&auto=format&fit=crop&w=40&h=40"
  },
  {
    id: 3,
    name: "Marvel Legends 2023",
    completion: "23/50 cards (46%)",
    value: "$678", 
    change: "-$23",
    image: "https://images.unsplash.com/photo-1635805737707-575885ab0820?ixlib=rb-4.0.3&auto=format&fit=crop&w=40&h=40"
  }
];

export function QuickActions() {
  const handleUploadCards = () => {
    console.log('Upload cards action');
  };

  const handleScanCard = () => {
    console.log('Scan card action');
  };

  const handleManualAdd = () => {
    console.log('Manual add action');
  };

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="font-bebas text-lg tracking-wide">QUICK ACTIONS</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="ghost"
            className="w-full justify-start bg-gray-50 hover:bg-gray-100 p-4 h-auto border border-gray-200 comic-border"
            onClick={handleUploadCards}
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-marvel-red rounded-lg flex items-center justify-center group-hover:bg-red-700 transition-colors">
                <Upload className="text-white text-sm" />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900">Upload Cards</p>
                <p className="text-xs text-gray-600">Bulk import from images</p>
              </div>
            </div>
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start bg-gray-50 hover:bg-gray-100 p-4 h-auto border border-gray-200 comic-border"
            onClick={handleScanCard}
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-marvel-gold rounded-lg flex items-center justify-center group-hover:bg-yellow-600 transition-colors">
                <Camera className="text-white text-sm" />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900">Scan Card</p>
                <p className="text-xs text-gray-600">Auto-identify with camera</p>
              </div>
            </div>
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start bg-gray-50 hover:bg-gray-100 p-4 h-auto border border-gray-200 comic-border"
            onClick={handleManualAdd}
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-700 transition-colors">
                <Plus className="text-white text-sm" />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900">Add Manually</p>
                <p className="text-xs text-gray-600">Enter card details</p>
              </div>
            </div>
          </Button>
        </CardContent>
      </Card>

      {/* Top Sets */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-bebas text-lg tracking-wide">TOP SETS</CardTitle>
            <Button variant="ghost" className="text-marvel-red hover:text-red-700">
              Manage
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topSets.map((set) => (
              <div 
                key={set.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex items-center space-x-3">
                  <img 
                    src={set.image} 
                    alt={set.name}
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{set.name}</p>
                    <p className="text-xs text-gray-600">{set.completion}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{set.value}</p>
                  <p className={`text-xs ${
                    set.change.startsWith('+') ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {set.change}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
