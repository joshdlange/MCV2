import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { CardSet, InsertCard } from "@shared/schema";
import { Plus, Save } from "lucide-react";

export default function CardEditor() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState<InsertCard>({
    setId: 0,
    cardNumber: "",
    name: "",
    variation: "",
    isInsert: false,
    imageUrl: "",
    rarity: "Common",
    estimatedValue: "",
  });

  const { data: cardSets } = useQuery<CardSet[]>({
    queryKey: ["/api/card-sets"],
  });

  const createCardMutation = useMutation({
    mutationFn: (data: InsertCard) => apiRequest("POST", "/api/cards", data),
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Card created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      // Reset form
      setFormData({
        setId: 0,
        cardNumber: "",
        name: "",
        variation: "",
        isInsert: false,
        imageUrl: "",
        rarity: "Common",
        estimatedValue: "",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create card",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.setId || !formData.cardNumber || !formData.name) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    createCardMutation.mutate(formData);
  };

  const handleInputChange = (field: keyof InsertCard, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bebas text-gray-900 tracking-wide">CARD EDITOR</h2>
            <p className="text-sm text-gray-600 font-roboto">
              Add new cards to the database.
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="p-6">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="font-bebas text-lg tracking-wide">ADD NEW CARD</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Card Set */}
                  <div className="space-y-2">
                    <Label htmlFor="setId">Card Set *</Label>
                    <Select 
                      value={formData.setId.toString()} 
                      onValueChange={(value) => handleInputChange('setId', parseInt(value))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a card set" />
                      </SelectTrigger>
                      <SelectContent>
                        {cardSets?.map((set) => (
                          <SelectItem key={set.id} value={set.id.toString()}>
                            {set.name} ({set.year})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Card Number */}
                  <div className="space-y-2">
                    <Label htmlFor="cardNumber">Card Number *</Label>
                    <Input
                      id="cardNumber"
                      value={formData.cardNumber}
                      onChange={(e) => handleInputChange('cardNumber', e.target.value)}
                      placeholder="e.g., 001, A1, SP-01"
                    />
                  </div>

                  {/* Card Name */}
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="name">Card Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => handleInputChange('name', e.target.value)}
                      placeholder="e.g., Spider-Man, Iron Man"
                    />
                  </div>

                  {/* Variation */}
                  <div className="space-y-2">
                    <Label htmlFor="variation">Variation</Label>
                    <Input
                      id="variation"
                      value={formData.variation}
                      onChange={(e) => handleInputChange('variation', e.target.value)}
                      placeholder="e.g., Foil, Parallel, Autograph"
                    />
                  </div>

                  {/* Rarity */}
                  <div className="space-y-2">
                    <Label htmlFor="rarity">Rarity *</Label>
                    <Select 
                      value={formData.rarity} 
                      onValueChange={(value) => handleInputChange('rarity', value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Common">Common</SelectItem>
                        <SelectItem value="Uncommon">Uncommon</SelectItem>
                        <SelectItem value="Rare">Rare</SelectItem>
                        <SelectItem value="Epic">Epic</SelectItem>
                        <SelectItem value="Legendary">Legendary</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Is Insert */}
                  <div className="flex items-center space-x-2 md:col-span-2">
                    <Switch
                      id="isInsert"
                      checked={formData.isInsert}
                      onCheckedChange={(checked) => handleInputChange('isInsert', checked)}
                    />
                    <Label htmlFor="isInsert">Insert Card (Special/Chase card)</Label>
                  </div>

                  {/* Image URL */}
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="imageUrl">Image URL</Label>
                    <Input
                      id="imageUrl"
                      value={formData.imageUrl}
                      onChange={(e) => handleInputChange('imageUrl', e.target.value)}
                      placeholder="https://example.com/image.jpg"
                    />
                  </div>

                  {/* Estimated Value */}
                  <div className="space-y-2">
                    <Label htmlFor="estimatedValue">Estimated Value ($)</Label>
                    <Input
                      id="estimatedValue"
                      type="number"
                      step="0.01"
                      value={formData.estimatedValue}
                      onChange={(e) => handleInputChange('estimatedValue', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end space-x-4">
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={() => setFormData({
                      setId: 0,
                      cardNumber: "",
                      name: "",
                      variation: "",
                      isInsert: false,
                      imageUrl: "",
                      rarity: "Common",
                      estimatedValue: "",
                    })}
                  >
                    Clear Form
                  </Button>
                  <Button 
                    type="submit" 
                    className="bg-marvel-red hover:bg-red-700"
                    disabled={createCardMutation.isPending}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {createCardMutation.isPending ? "Creating..." : "Create Card"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Image Preview */}
          {formData.imageUrl && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="font-bebas text-lg tracking-wide">IMAGE PREVIEW</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center">
                  <img 
                    src={formData.imageUrl} 
                    alt="Card preview"
                    className="max-w-64 h-auto rounded-lg shadow-lg"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      toast({
                        title: "Invalid Image",
                        description: "Could not load the image from the provided URL",
                        variant: "destructive",
                      });
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
