"use client";

import { Fragment } from "react";
import { ArrowUpRight, CornerDownRight, Info, Star, TriangleAlert } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { insightCategories, type LayoutInsight, type LayoutRating } from "@/lib/layout-insights";

const labels = { access: "Access & movement", crowds: "Crowds & queues", exhibitors: "Exhibitor placement", amenities: "Amenities & comfort" };

export default function LayoutInsights({ findings, rating, simulated, onSelect }: {
  findings: LayoutInsight[];
  rating: LayoutRating;
  simulated: boolean;
  onSelect: (id: string) => void;
}) {
  return <>
    <div className="insight-panel-heading">
      <h3>Layout insights</h3>
    </div>
    <div className="insight-rating" aria-live="polite">
      <div className="insight-rating-line">
        <span className="insight-rating-label">Overall layout</span>
        <span className="insight-stars" role="img" aria-label={rating.stars === null ? "Layout not yet rated" : `Layout rated ${rating.stars} out of 5 stars`}>
          {Array.from({ length: 5 }, (_, index) => <span className="insight-star" key={index} aria-hidden="true">
            <Star size={32} className="insight-star-empty" />
            <Star size={32} className="insight-star-filled" style={{ clipPath: `inset(0 ${100 - Math.max(0, Math.min(1, (rating.stars ?? 0) - index)) * 100}% 0 0)` }} />
          </span>)}
        </span>
        <strong className="insight-rating-value">{rating.stars === null ? "Not rated" : `${rating.stars}/5`}</strong>
      </div>
      <p>{rating.description}</p>
    </div>
    <Accordion type="multiple" defaultValue={insightCategories.filter(category => findings.some(f => f.category === category.id)).map(category => category.id)} className="insight-categories">
      {insightCategories.map(category => {
        const entries = findings.filter(f => f.category === category.id);
        return <AccordionItem key={category.id} value={category.id} className="insight-category">
          <AccordionTrigger className="insight-category-trigger">
            <span>{labels[category.id]}</span>
            <span className="insight-count" aria-label={`${entries.length} finding${entries.length === 1 ? "" : "s"}`}>{entries.length}</span>
          </AccordionTrigger>
          <AccordionContent className="insight-category-content">
            {entries.length ? <ul className="insight-entries" aria-label={`${labels[category.id]} issues and suggestions`}>
              {entries.map(finding => <Fragment key={finding.id}>
                <li className={`insight-issue-row ${finding.level}`} title={finding.detail}>
                  {finding.level === "warning" ? <TriangleAlert size={15} aria-label="Issue" /> : <Info size={15} aria-label="Observation" />}
                  <div className="insight-issue-copy"><h4>{finding.title}</h4></div>
                  {finding.itemId && <Button type="button" variant="ghost" size="icon-sm" className="insight-map-action"
                    aria-label={`Show on map: ${finding.title}`} title="Show on map" onClick={() => onSelect(finding.itemId!)}>
                    <ArrowUpRight size={16} />
                  </Button>}
                </li>
                <li className="insight-action-row" aria-label={`Suggestion for ${finding.title}`}>
                  <CornerDownRight size={14} aria-hidden="true" />
                  <p>{finding.suggestion}</p>
                </li>
              </Fragment>)}
            </ul> : <p className="insight-empty">{!simulated && category.id !== "access" ? "Awaiting simulation" : "No issues detected"}</p>}
          </AccordionContent>
        </AccordionItem>;
      })}
    </Accordion>
  </>;
}
